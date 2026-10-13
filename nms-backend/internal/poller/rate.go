package poller

import (
	"math/big"
	"time"
)

var two64 = new(big.Int).Lsh(big.NewInt(1), 64)

// counterDelta returns cur-prev, handling a single 64-bit wrap. ok=false when prev is unknown
// or the counter went backwards by a device restart (cur < prev with a huge apparent wrap).
func counterDelta(prev, cur *big.Int) (delta *big.Int, ok bool) {
	if prev == nil || cur == nil {
		return nil, false
	}
	d := new(big.Int).Sub(cur, prev)
	if d.Sign() >= 0 {
		return d, true
	}
	// A real wrap yields a small positive delta after adding 2^64; a reset yields an enormous one.
	w := d.Add(d, two64)
	if w.Cmp(big.NewInt(1<<62)) > 0 {
		return nil, false
	}
	return w, true
}

// bitsPerSecond converts an octet delta over an interval into bits/s.
func bitsPerSecond(prev, cur *big.Int, dt time.Duration) (float64, bool) {
	d, ok := counterDelta(prev, cur)
	if !ok || dt <= 0 {
		return 0, false
	}
	f, _ := new(big.Float).SetInt(d).Float64()
	return f * 8 / dt.Seconds(), true
}
