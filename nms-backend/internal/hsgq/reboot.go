package hsgq

import (
	"context"
	"fmt"
	"regexp"
	"strconv"

	"github.com/nepalairlink/nms/internal/olt"
)

// OntReset builds the config-mode line that restarts one ONT: `ont reset <pon 1-16> <onu 0-127>`.
// `ont reset <pon> all` and a bare `reboot` (which restarts the whole OLT) are not representable.
func OntReset(pon, ont int) (string, error) {
	if pon < 1 || pon > 16 {
		return "", fmt.Errorf("pon %d out of range 1..16", pon)
	}
	if ont < 0 || ont > 127 {
		return "", fmt.Errorf("ont id %d out of range 0..127", ont)
	}
	return "ont reset " + strconv.Itoa(pon) + " " + strconv.Itoa(ont), nil
}

var ontResetRe = regexp.MustCompile(`^ont reset (\d{1,2}) (\d{1,3})$`)

// checkOntReset is the last guard before the line is sent: exactly one in-range single-ONT reset, nothing else.
func checkOntReset(cmd string) error {
	m := ontResetRe.FindStringSubmatch(cmd)
	if m == nil {
		return fmt.Errorf("%w: %q", ErrReadOnly, cmd)
	}
	pon, _ := strconv.Atoi(m[1])
	ont, _ := strconv.Atoi(m[2])
	if _, err := OntReset(pon, ont); err != nil {
		return err
	}
	return nil
}

// RebootONT restarts one ONT. The session is already in config mode (hsgq.Dialer), so only the reset line is sent.
// This is the only write the HSGQ driver performs; sync sessions stay behind readOnlyExec.
func (s *Service) RebootONT(ctx context.Context, oltID int64, pon, ontID int) error {
	line, err := OntReset(pon, ontID)
	if err != nil {
		return err
	}
	if err := checkOntReset(line); err != nil {
		return err
	}
	ex, err := s.dialer.Dial(ctx, oltID)
	if err != nil {
		return fmt.Errorf("cannot connect to OLT: %w", err)
	}
	defer ex.Close()
	out, err := ex.Run(ctx, olt.VendorWriteCmd(line))
	if err != nil {
		return fmt.Errorf("%s: %w", line, err)
	}
	if msg := olt.OutputError(out); msg != "" {
		return fmt.Errorf("%s: %s", line, msg)
	}
	return nil
}
