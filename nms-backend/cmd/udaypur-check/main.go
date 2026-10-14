package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/nepalairlink/nms/internal/config"
	"github.com/nepalairlink/nms/internal/olt"
	"github.com/nepalairlink/nms/internal/secretbox"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Println("config:", err)
		return
	}
	dbConn, err := sql.Open("mysql", cfg.DatabaseURL)
	if err != nil {
		fmt.Println("db:", err)
		return
	}
	defer dbConn.Close()

	box, err := secretbox.New(cfg.SecretKey)
	if err != nil {
		fmt.Println("box:", err)
		return
	}

	dialer := olt.PGDialer{DB: dbConn, Box: box}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	ex, err := dialer.Dial(ctx, 2)
	if err != nil {
		fmt.Println("dial:", err)
		return
	}
	defer ex.Close()

	cmd, err := olt.DisplayONTOpticalPos(0, 2, 2, 40)
	if err != nil {
		fmt.Println("cmd err:", err)
		return
	}
	fmt.Printf(">>> %s\n", cmd.String())
	out, err := ex.Run(ctx, cmd)
	if err != nil {
		fmt.Println("run err:", err)
	}
	fmt.Println(out)
}
