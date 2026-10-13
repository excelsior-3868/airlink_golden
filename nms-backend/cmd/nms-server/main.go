// nms-server runs the API, pollers, alert engine, escalation worker and OLT monitor.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nepalairlink/nms/internal/alerts"
	"github.com/nepalairlink/nms/internal/api"
	"github.com/nepalairlink/nms/internal/config"
	"github.com/nepalairlink/nms/internal/db"
	"github.com/nepalairlink/nms/internal/olt"
	"github.com/nepalairlink/nms/internal/poller"
	"github.com/nepalairlink/nms/internal/secretbox"
	"github.com/nepalairlink/nms/internal/vpn"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if tun := (vpn.Config{ConfigFile: cfg.VPNConfig, Username: cfg.VPNUser, Password: cfg.VPNPass, KeyPass: cfg.VPNKeyPass, Routes: cfg.VPNRoutes}); tun.Enabled() {
		go func() {
			if err := vpn.Run(ctx, tun); err != nil {
				slog.Error("vpn", "err", err)
			}
		}()
	}

	dbConn, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer dbConn.Close()
	if err := db.Migrate(ctx, dbConn); err != nil {
		return err
	}

	engine := alerts.NewEngine(dbConn)
	p := poller.New(dbConn, engine, cfg.PollerID, cfg.PollInterval, cfg.PollWorkers)
	go p.Run(ctx)

	if os.Getenv("NMS_MODE") == "poller" {
		slog.Info("running in poller-only mode", "poller_id", cfg.PollerID)
		<-ctx.Done()
		return nil
	}

	var notifier alerts.Notifier = alerts.LogNotifier{}
	if cfg.WebhookURL != "" {
		notifier = alerts.WebhookNotifier{URL: cfg.WebhookURL}
	}
	go alerts.NewEscalator(dbConn, notifier).Run(ctx)

	box, err := secretbox.New(cfg.SecretKey)
	if err != nil {
		return err
	}
	dialer := olt.PGDialer{DB: dbConn, Box: box}
	svc := olt.NewService(dbConn, dialer, cfg.SaveAfterApply)
	roDialer := olt.PGDialer{DB: dbConn, ReadOnly: true, Box: box}
	svc.SetReadOnlyDialer(roDialer)
	if cfg.OLTSyncInterval > 0 {
		go svc.RunSyncLoop(ctx, cfg.OLTSyncInterval)
	}
	if !cfg.DisableOLTPoll {
		go olt.NewMonitor(dbConn, roDialer, engine, cfg.OLTPollInterval).Run(ctx)
	}

	apiServer := api.New(dbConn, cfg, engine, svc)
	apiServer.SetSecretBox(box)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		sh, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		srv.Shutdown(sh)
	}()
	slog.Info("nms-server listening", "addr", cfg.HTTPAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
