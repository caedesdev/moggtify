package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

const (
	AppName    = "Moggtify"
	AppVersion = "1.0.0"
	RepoURL    = "https://github.com/caedesdev/moggtify"
)

func localAppData() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return v
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "AppData", "Local")
}

func roamingAppData() string {
	if v := os.Getenv("APPDATA"); v != "" {
		return v
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "AppData", "Roaming")
}

// Moggtify's own data (config, webview cache).
func dataDir() string        { return filepath.Join(localAppData(), AppName) }
func configPath() string     { return filepath.Join(dataDir(), "config.json") }
func webviewDataDir() string { return filepath.Join(dataDir(), "webview") }

// Where the app installs itself.
func installDir() string   { return filepath.Join(localAppData(), "Programs", AppName) }
func installedExe() string { return filepath.Join(installDir(), AppName+".exe") }

// Config is what the user picked in Moggtify. The Spicetify config file is
// derived from it on every apply.
type Config struct {
	Extensions  map[string]bool `json:"extensions"` // Spicetify extension file -> enabled
	Apps        map[string]bool `json:"apps"`       // custom app folder -> enabled
	Extras      map[string]bool `json:"extras"`     // Moggtify extras -> enabled
	AutoReapply bool            `json:"autoReapply"`
	Patched     bool            `json:"patched"`     // user wants Spotify modded
	EngineOwned bool            `json:"engineOwned"` // we installed Spicetify ourselves
	Rev         int64           `json:"rev"`
}

func defaultConfig() Config {
	cfg := Config{
		Extensions:  map[string]bool{},
		Apps:        map[string]bool{},
		Extras:      map[string]bool{},
		AutoReapply: true,
		Rev:         time.Now().UnixMilli(),
	}
	for _, e := range bundledExtensions {
		cfg.Extensions[e.ID] = e.Default
	}
	for _, a := range bundledApps {
		cfg.Apps[a.ID] = a.Default
	}
	for _, x := range extrasCatalog() {
		cfg.Extras[x.ID] = x.Default
	}
	return cfg
}

func loadConfig() Config {
	cfg := defaultConfig()
	b, err := os.ReadFile(configPath())
	if err != nil {
		return cfg
	}
	var saved Config
	if json.Unmarshal(b, &saved) != nil {
		return cfg
	}
	// Merge so newly added catalog entries get their defaults.
	for k, v := range saved.Extensions {
		cfg.Extensions[k] = v
	}
	for k, v := range saved.Apps {
		cfg.Apps[k] = v
	}
	for k, v := range saved.Extras {
		cfg.Extras[k] = v
	}
	cfg.AutoReapply = saved.AutoReapply
	cfg.Patched = saved.Patched
	cfg.EngineOwned = saved.EngineOwned
	if saved.Rev != 0 {
		cfg.Rev = saved.Rev
	}
	cfg.Apps["marketplace"] = true // the Marketplace is the point of the whole thing
	return cfg
}

func saveConfig(cfg Config) error {
	if err := os.MkdirAll(dataDir(), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	tmp := configPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, configPath())
}

/* ---- small fs helpers ---- */

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	os.Remove(dst)
	return os.Rename(tmp, dst)
}

// retry runs fn until it succeeds or the timeout passes. Spotify sometimes
// keeps file handles open for a moment after its process ended.
func retry(timeout time.Duration, fn func() error) error {
	deadline := time.Now().Add(timeout)
	for {
		err := fn()
		if err == nil || time.Now().After(deadline) {
			return err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func removeAll(p string) error {
	return retry(6*time.Second, func() error {
		err := os.RemoveAll(p)
		if err != nil && errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	})
}
