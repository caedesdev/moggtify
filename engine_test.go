package main

import (
	"archive/zip"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fakeEnv(t *testing.T) string {
	t.Helper()
	noProcessControl = true
	root := t.TempDir()
	t.Setenv("APPDATA", filepath.Join(root, "Roaming"))
	t.Setenv("LOCALAPPDATA", filepath.Join(root, "Local"))
	return root
}

func TestConfigArgs(t *testing.T) {
	fakeEnv(t)
	cfg := defaultConfig()
	cfg.Extensions["popupLyrics.js"] = true
	cfg.Extensions["trashbin.js"] = false
	args := configArgs(cfg, []string{"trashbin.js", "foreign.js", "moggtify.js"}, []string{"reddit"}, "")
	got := strings.Join(args, " ")
	for _, want := range []string{
		"extensions popupLyrics.js", "extensions fullAppDisplay.js",
		"extensions trashbin.js-",
		"custom_apps marketplace", "custom_apps lyrics-plus", "custom_apps reddit-",
		"current_theme marketplace", "inject_css 1", "check_spicetify_update 0",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, "foreign.js") {
		t.Error("unknown extensions must be left alone")
	}
	// Existing user theme must not be replaced.
	if strings.Contains(strings.Join(configArgs(cfg, nil, nil, "Sleek"), " "), "current_theme") {
		t.Error("existing theme overwritten")
	}
}

func TestReadSpiceConfigAndState(t *testing.T) {
	fakeEnv(t)
	_ = os.MkdirAll(spiceUserData(), 0o755)
	ini := "[Setting]\ncurrent_theme = marketplace\nspotify_path = C:\\x\n\n[AdditionalOptions]\nextensions = a.js|b.js\ncustom_apps = marketplace|lyrics-plus\n"
	_ = os.WriteFile(spiceConfigFile(), []byte(ini), 0o644)
	c := readSpiceConfig()
	if c["Setting"]["current_theme"] != "marketplace" {
		t.Fatal("theme not parsed")
	}
	if l := spiceList("extensions"); len(l) != 2 || l[1] != "b.js" {
		t.Fatalf("extensions = %v", l)
	}
	// local extension shows up, bundled ones and our extras file don't
	ext := filepath.Join(spiceUserData(), "Extensions")
	_ = os.MkdirAll(ext, 0o755)
	for _, f := range []string{"mine.js", "trashbin.js", extrasFile} {
		_ = os.WriteFile(filepath.Join(ext, f), []byte("//"), 0o644)
	}
	loc := localExtensions()
	if len(loc) != 1 || loc[0].ID != "mine.js" {
		t.Fatalf("local = %+v", loc)
	}
}

func TestExtrasBundleIsValidJS(t *testing.T) {
	cfg := defaultConfig()
	cfg.Extras["stage"] = true
	b := buildExtras(cfg)
	if strings.Contains(string(b), "__MOGG_VERSION__") {
		t.Fatal("version placeholder left")
	}
	if !strings.Contains(string(b), `"design":"spotify"`) || !strings.Contains(string(b), `"fullAppDisplay.js"`) {
		t.Fatal("client config incomplete")
	}
	if _, err := exec.LookPath("node"); err == nil {
		f := filepath.Join(t.TempDir(), "x.js")
		_ = os.WriteFile(f, b, 0o644)
		if out, err := exec.Command("node", "--check", f).CombinedOutput(); err != nil {
			t.Fatalf("bundle is not valid JS: %s", out)
		}
	}
}

func TestUnzipStrip(t *testing.T) {
	dir := t.TempDir()
	zp := filepath.Join(dir, "m.zip")
	f, _ := os.Create(zp)
	zw := zip.NewWriter(f)
	for name, body := range map[string]string{"marketplace-dist/manifest.json": "{}", "marketplace-dist/index.js": "x", "other/skip.txt": "no", "../evil": "x"} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	zw.Close()
	f.Close()
	out := filepath.Join(dir, "out")
	if err := unzipTo(zp, out, "marketplace-dist/"); err != nil {
		t.Fatal(err)
	}
	if !exists(filepath.Join(out, "manifest.json")) || exists(filepath.Join(out, "skip.txt")) || exists(filepath.Join(out, "other")) {
		t.Fatal("strip extraction wrong")
	}
	if err := unzipTo(zp, filepath.Join(dir, "all"), ""); err == nil {
		t.Fatal("zip-slip entry must be rejected")
	}
}

func TestPatchStatus(t *testing.T) {
	fakeEnv(t)
	if s := patchStatus(); s != "missing" {
		t.Fatalf("got %s", s)
	}
	_ = os.MkdirAll(appsDir(), 0o755)
	_ = os.WriteFile(spaPath(), []byte("zip"), 0o644)
	if s := patchStatus(); s != "clean" {
		t.Fatalf("got %s", s)
	}
	_ = os.MkdirAll(xpuiDir(), 0o755)
	_ = os.WriteFile(filepath.Join(xpuiDir(), "index.html"), []byte(`<script src="helper/spicetifyWrapper.js"></script>`), 0o644)
	if s := patchStatus(); s != "outdated" {
		t.Fatalf("got %s", s)
	}
	_ = os.Remove(spaPath())
	if s := patchStatus(); s != "patched" {
		t.Fatalf("got %s", s)
	}
}

func TestVersionCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{{"2.40.1", "2.39.9", true}, {"2.40.0", "2.40.0", false}, {"2.9.0", "2.10.0", false}, {"3.0.0", "2.99.99", true}}
	for _, c := range cases {
		if newerVersion(c.a, c.b) != c.want {
			t.Errorf("newerVersion(%s,%s) != %v", c.a, c.b, c.want)
		}
	}
}

func TestConfigMergeKeepsMarketplace(t *testing.T) {
	fakeEnv(t)
	cfg := defaultConfig()
	cfg.Apps["marketplace"] = false
	cfg.Extensions["shuffle+.js"] = false
	if err := saveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	got := loadConfig()
	if !got.Apps["marketplace"] || got.Extensions["shuffle+.js"] {
		t.Fatalf("load/merge wrong: %+v", got)
	}
}

func TestRestoreVanillaAfterSpotifyUpdate(t *testing.T) {
	fakeEnv(t)
	_ = os.MkdirAll(xpuiDir(), 0o755)
	_ = os.WriteFile(spaPath(), []byte("fresh spa from the update"), 0o644)
	_ = os.WriteFile(filepath.Join(xpuiDir(), "index.html"), []byte(`<script src="helper/spicetifyWrapper.js"></script>`), 0o644)
	if s := patchStatus(); s != "outdated" {
		t.Fatalf("setup: %s", s)
	}
	if err := restoreVanilla(); err != nil {
		t.Fatal(err)
	}
	if s := patchStatus(); s != "clean" {
		t.Fatalf("after restore: %s", s)
	}
	if b, _ := os.ReadFile(spaPath()); string(b) != "fresh spa from the update" {
		t.Fatal("the updated client must be kept, not replaced by an old backup")
	}
}

func TestRestoreVanillaFromBackupWithoutEngine(t *testing.T) {
	fakeEnv(t)
	if spiceExe() != "" {
		t.Skip("spicetify on PATH")
	}
	_ = os.MkdirAll(xpuiDir(), 0o755)
	_ = os.WriteFile(filepath.Join(xpuiDir(), "index.html"), []byte(`spicetify`), 0o644)
	bak := filepath.Join(spiceStateDir(), "Backup", "xpui.spa")
	_ = os.MkdirAll(filepath.Dir(bak), 0o755)
	_ = os.WriteFile(bak, []byte("vanilla"), 0o644)
	if err := restoreVanilla(); err != nil {
		t.Fatal(err)
	}
	if s := patchStatus(); s != "clean" {
		t.Fatalf("after restore: %s", s)
	}
	// And without any backup it must refuse instead of pretending.
	_ = os.Remove(spaPath())
	_ = os.MkdirAll(xpuiDir(), 0o755)
	_ = os.WriteFile(filepath.Join(xpuiDir(), "index.html"), []byte(`spicetify`), 0o644)
	_ = os.Remove(bak)
	if err := restoreVanilla(); err == nil {
		t.Fatal("expected an error when nothing can be restored")
	}
}

func TestEngineLockIsExclusive(t *testing.T) {
	inside := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- withEngineLock(time.Second, func() error { close(inside); <-release; return nil })
	}()
	<-inside
	if err := withEngineLock(200*time.Millisecond, func() error { return nil }); err != errEngineBusy {
		t.Fatalf("second holder got %v, want errEngineBusy", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	ran := false
	if err := withEngineLock(time.Second, func() error { ran = true; return nil }); err != nil || !ran {
		t.Fatalf("lock not released: %v", err)
	}
}
