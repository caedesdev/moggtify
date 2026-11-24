package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSandboxPatch runs the real engine against a COPY of Spotify.
//
//	MOGG_SANDBOX=1 MOGG_SPOTIFY_DIR=<copy> SPICETIFY_CONFIG=<cfg dir> SPICETIFY_STATE=<state dir> go test -run Sandbox -v
//
// The config dir must contain a config-xpui.ini whose spotify_path and
// prefs_path point at the copy. The real Spotify install is never touched
// and no process is killed or started.
func TestSandboxPatch(t *testing.T) {
	if os.Getenv("MOGG_SANDBOX") == "" {
		t.Skip("set MOGG_SANDBOX=1 to run against a Spotify copy")
	}
	noProcessControl = true
	if spiceExe() == "" {
		t.Fatal("engine not installed")
	}
	if os.Getenv("SPICETIFY_STATE") == "" || os.Getenv("SPICETIFY_CONFIG") == "" || os.Getenv("MOGG_SPOTIFY_DIR") == "" {
		t.Fatal("set SPICETIFY_CONFIG, SPICETIFY_STATE and MOGG_SPOTIFY_DIR so nothing real is touched")
	}
	cfg := defaultConfig()
	cfg.Extras["stage"] = true

	if err := writeEngineConfig(cfg); err != nil {
		t.Fatalf("config: %v", err)
	}
	ini := readSpiceConfig()
	t.Logf("extensions = %s", ini["AdditionalOptions"]["extensions"])
	t.Logf("custom_apps = %s", ini["AdditionalOptions"]["custom_apps"])
	t.Logf("current_theme = %s", ini["Setting"]["current_theme"])
	for _, want := range []string{"fullAppDisplay.js", "trashbin.js", "moggtify.js"} {
		if !contains(splitList(ini["AdditionalOptions"]["extensions"]), want) {
			t.Errorf("extension %s not enabled", want)
		}
	}
	if !contains(splitList(ini["AdditionalOptions"]["custom_apps"]), "marketplace") {
		t.Error("marketplace not enabled")
	}

	var steps []string
	if err := patch(func(step, st, detail string) {
		if st == "done" {
			steps = append(steps, step)
		}
	}, false); err != nil {
		t.Fatalf("patch: %v", err)
	}
	t.Logf("steps: %v, status: %s", steps, patchStatus())
	idx, _ := os.ReadFile(filepath.Join(xpuiDir(), "index.html"))
	if !strings.Contains(string(idx), "spicetify") {
		t.Fatal("index.html not patched")
	}
	var found []string
	_ = filepath.Walk(xpuiDir(), func(p string, fi os.FileInfo, err error) error {
		low := strings.ToLower(p)
		if err == nil && !fi.IsDir() && (strings.Contains(low, "marketplace") || strings.HasSuffix(low, "moggtify.js")) && len(found) < 6 {
			rel, _ := filepath.Rel(xpuiDir(), p)
			found = append(found, rel)
		}
		return nil
	})
	t.Logf("injected files: %v", found)
	if len(found) < 2 {
		t.Error("marketplace / moggtify extras not copied into the client")
	}

	// Second run = an apply on an already patched client (toggle change).
	cfg.Extensions["popupLyrics.js"] = true
	if err := writeEngineConfig(cfg); err != nil {
		t.Fatal(err)
	}
	if err := patch(nil, false); err != nil {
		t.Fatalf("re-apply: %v", err)
	}

	// Restore must bring the vanilla client back.
	if err := restoreVanilla(); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if s := patchStatus(); s != "clean" {
		t.Fatalf("after restore: %s", s)
	}
}

// TestSandboxSpotifyUpdate simulates the situation after a Spotify update: a
// fresh xpui.spa sits next to the stale modded folder ("outdated"). Repair /
// the watcher run writeEngineConfig + patch – that must end up "patched".
//
//	MOGG_SANDBOX=update MOGG_FRESH_SPA=<vanilla xpui.spa> ... go test -run SandboxSpotifyUpdate -v
func TestSandboxSpotifyUpdate(t *testing.T) {
	if os.Getenv("MOGG_SANDBOX") != "update" {
		t.Skip("set MOGG_SANDBOX=update")
	}
	if os.Getenv("SPICETIFY_STATE") == "" || os.Getenv("SPICETIFY_CONFIG") == "" || os.Getenv("MOGG_SPOTIFY_DIR") == "" {
		t.Fatal("set SPICETIFY_CONFIG, SPICETIFY_STATE and MOGG_SPOTIFY_DIR so nothing real is touched")
	}
	noProcessControl = true
	cfg := defaultConfig()
	if patchStatus() != "patched" { // start from a modded client
		if err := writeEngineConfig(cfg); err != nil {
			t.Fatal(err)
		}
		if err := patch(nil, false); err != nil {
			t.Fatalf("initial patch: %v", err)
		}
	}
	// The "update": Spotify drops a fresh xpui.spa next to the modded folder.
	if err := copyFile(os.Getenv("MOGG_FRESH_SPA"), spaPath()); err != nil {
		t.Fatal(err)
	}
	if s := patchStatus(); s != "outdated" {
		t.Fatalf("setup: want outdated, got %s", s)
	}
	if err := writeEngineConfig(cfg); err != nil {
		t.Fatal(err)
	}
	if err := patch(nil, false); err != nil {
		t.Fatalf("re-apply after update: %v", err)
	}
	if s := patchStatus(); s != "patched" {
		t.Fatalf("after re-apply: %s", s)
	}
	if spiceBackupSpa() == "" {
		t.Fatal("no backup of the updated client was made")
	}
	// Delete after an update must work as well.
	if err := restoreVanilla(); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if s := patchStatus(); s != "clean" {
		t.Fatalf("after restore: %s", s)
	}
}
