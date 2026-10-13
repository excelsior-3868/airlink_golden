package poller

import (
	"math/big"
	"testing"
	"time"
)

func TestBitsPerSecond(t *testing.T) {
	bps, ok := bitsPerSecond(big.NewInt(1000), big.NewInt(1000+7_500_000), 60*time.Second)
	if !ok || bps != 1_000_000 {
		t.Fatalf("got %v %v, want 1,000,000 bps", bps, ok)
	}
}

func TestCounterWrap(t *testing.T) {
	prev := new(big.Int).Sub(two64, big.NewInt(100))
	d, ok := counterDelta(prev, big.NewInt(50))
	if !ok || d.Int64() != 150 {
		t.Fatalf("wrap delta = %v %v, want 150", d, ok)
	}
}

func TestCounterReset(t *testing.T) {
	// Counter dropped far below previous value: device restart, not a wrap -> discard sample.
	if _, ok := counterDelta(big.NewInt(5_000_000_000_000_000_000), big.NewInt(10)); ok {
		t.Fatal("reset should be rejected")
	}
}

func TestNoPrevious(t *testing.T) {
	if _, ok := bitsPerSecond(nil, big.NewInt(1), time.Second); ok {
		t.Fatal("no previous sample must not produce a rate")
	}
}
