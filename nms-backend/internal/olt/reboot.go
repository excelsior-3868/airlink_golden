package olt

import (
	"context"
	"fmt"
)

// RebootONT restarts one ONT on a Huawei OLT: interface gpon <f>/<s>, ont reset <port> <ont>, quit.
// Every command is built from range-checked integers before the OLT is dialled.
func (s *Service) RebootONT(ctx context.Context, oltID int64, frame, slot, port, ontID int) error {
	iface, err := InterfaceGpon(frame, slot)
	if err != nil {
		return err
	}
	reset, err := OntReset(port, ontID)
	if err != nil {
		return err
	}
	ex, err := s.dialer.Dial(ctx, oltID)
	if err != nil {
		return fmt.Errorf("cannot connect to OLT: %w", err)
	}
	defer ex.Close()
	for _, c := range []Cmd{iface, reset} {
		out, err := ex.Run(ctx, c)
		if err != nil {
			return fmt.Errorf("%s: %w", c.String(), err)
		}
		if msg := OutputError(out); msg != "" {
			return fmt.Errorf("%s: %s", c.String(), msg)
		}
	}
	_, _ = ex.Run(ctx, Quit())
	return nil
}
