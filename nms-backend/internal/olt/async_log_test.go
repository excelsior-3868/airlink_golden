package olt

import "testing"

// HSGQ OLTs push timestamped log lines into the session at any moment (an ONU flapping logs every few seconds).
// When one lands right after the prompt the prompt is no longer the last text in the buffer; with the filter on,
// the prompt must still be found, and the log text must not leak into command output.
func TestSnapshotDropsAsyncLogLines(t *testing.T) {
	const prompt = "Golden-Hub-Jalpa-HSGQ-Gpon-OLT# "
	buf := "enable \r\n\r\n" + prompt + "\r\n[2020/09/27 03:16:44+05:45]  Warning: ONU 3/28 ECOM6de10f9b ONU link down, Reason:Laser out\r\n\r\n" +
		"[2020/09/27 03:16:49+05:45]  Info: ONU 3/28 ECOM6de10f9b ONU authorization success\r\n"

	plain := &SSHExec{}
	plain.buf.WriteString(buf)
	if promptRe.MatchString(plain.snapshot()) {
		t.Fatal("without the filter the trailing log lines hide the prompt (the bug this guards against)")
	}

	e := &SSHExec{dropLogLines: true}
	e.buf.WriteString(buf)
	got := e.snapshot()
	if !promptRe.MatchString(got) {
		t.Fatalf("prompt not found after filtering: %q", got)
	}
	if want := "enable \r\n\r\n" + prompt; trimOutput(got, "enable") != trimOutput(want, "enable") {
		t.Fatalf("log text leaked into output: %q", got)
	}
}

func TestSnapshotKeepsPartialLogLineOutOfPrompt(t *testing.T) {
	e := &SSHExec{dropLogLines: true}
	e.buf.WriteString("show version\r\nSystem Version : V2\r\nOLT(config)# \r\n[2020/09/27 03:16:4")
	if got := e.snapshot(); !promptRe.MatchString(got) {
		t.Fatalf("half-received log line broke prompt detection: %q", got)
	}
}

func TestSnapshotLeavesOtherOutputAlone(t *testing.T) {
	e := &SSHExec{dropLogLines: true}
	e.buf.WriteString("1/0     GPON   MHAR06b409e3      Active    Online\r\nTotal: 17\r\n")
	if got := e.snapshot(); got != "1/0     GPON   MHAR06b409e3      Active    Online\r\nTotal: 17\r\n" {
		t.Fatalf("changed non-log text: %q", got)
	}
}
