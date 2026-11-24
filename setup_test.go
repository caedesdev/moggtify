package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// replaceExe must succeed while the target exe is running (that's the case
// when the background helper runs from the installed copy).
func TestReplaceExeWhileRunning(t *testing.T) {
	sys := os.Getenv("SystemRoot")
	if sys == "" {
		t.Skip("not Windows")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "Moggtify.exe")
	if err := copyFile(filepath.Join(sys, "System32", "PING.EXE"), target); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(target, "-n", "4", "127.0.0.1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Wait()
	time.Sleep(300 * time.Millisecond)

	src := filepath.Join(sys, "System32", "where.exe")
	if err := replaceExe(src, target); err != nil {
		t.Fatalf("replace while running: %v", err)
	}
	want, _ := os.ReadFile(src)
	got, _ := os.ReadFile(target)
	if !bytes.Equal(want, got) {
		t.Fatal("target was not replaced")
	}
	old, _ := filepath.Glob(target + ".old-*")
	if len(old) != 1 {
		t.Fatalf("expected the running exe to be renamed aside, found %v", old)
	}
}
