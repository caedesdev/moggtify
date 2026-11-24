package main

// The engine is Spicetify CLI – the same patcher the Marketplace and all
// community extensions are built for. Moggtify downloads it, drives it with
// hidden processes and never shows a terminal.

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	cliReleaseAPI    = "https://api.github.com/repos/spicetify/cli/releases/latest"
	cliLatestPage    = "https://github.com/spicetify/cli/releases/latest"
	cliDownloadFmt   = "https://github.com/spicetify/cli/releases/download/v%[1]s/spicetify-%[1]s-windows-%[2]s.zip"
	marketplaceZip   = "https://github.com/spicetify/marketplace/releases/latest/download/marketplace.zip"
	marketplaceColor = "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini"
)

func spiceDir() string { return filepath.Join(localAppData(), "spicetify") }

// spiceUserData is Spicetify's data folder. SPICETIFY_CONFIG is honoured
// the same way the engine itself honours it.
func spiceUserData() string {
	if v := os.Getenv("SPICETIFY_CONFIG"); v != "" {
		return v
	}
	return filepath.Join(roamingAppData(), "spicetify")
}

// spiceStateDir holds Spicetify's Backup and Extracted folders. It is
// separate from the config folder and has its own override.
func spiceStateDir() string {
	if v := os.Getenv("SPICETIFY_STATE"); v != "" {
		return v
	}
	return filepath.Join(roamingAppData(), "spicetify")
}

// spiceBackupSpa finds Spicetify's backup of the vanilla interface. With the
// default layout it lives in <state>/Backup; with SPICETIFY_STATE set the
// engine writes it straight into that folder.
func spiceBackupSpa() string {
	for _, p := range []string{
		filepath.Join(spiceStateDir(), "Backup", "xpui.spa"),
		filepath.Join(spiceStateDir(), "xpui.spa"),
	} {
		if exists(p) {
			return p
		}
	}
	return ""
}

func spiceConfigFile() string {
	return filepath.Join(spiceUserData(), "config-xpui.ini")
}

// spiceExe finds the engine: our default location first, then PATH.
func spiceExe() string {
	p := filepath.Join(spiceDir(), "spicetify.exe")
	if exists(p) {
		return p
	}
	if lp, err := exec.LookPath("spicetify"); err == nil {
		return lp
	}
	return ""
}

/* ---------------------------------------------------------------------- */
/* Running the CLI                                                         */
/* ---------------------------------------------------------------------- */

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// runSpice runs the engine hidden, with -q so every prompt takes its
// non-interactive answer, and returns the cleaned output.
func runSpice(args ...string) (string, error) {
	exe := spiceExe()
	if exe == "" {
		return "", errors.New("the Spicetify engine is not installed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Dir = filepath.Dir(exe)
	cmd.Stdin = strings.NewReader("")
	cmd.Env = append(os.Environ(), "NO_COLOR=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(ansiRe.ReplaceAllString(string(out), ""))
	if err != nil {
		if ctx.Err() != nil {
			return text, fmt.Errorf("Spicetify took too long (spicetify %s)", args[0])
		}
		if strings.TrimSpace(text) == "" {
			return text, fmt.Errorf("Spicetify stopped without details (spicetify %s, %v). Try Repair, or restart your PC and try again.", strings.Join(args, " "), err)
		}
		return text, fmt.Errorf("Spicetify: %s", lastLines(text, 4))
	}
	return text, nil
}

func lastLines(s string, n int) string {
	var lines []string
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	if len(lines) == 0 {
		return "no output"
	}
	return strings.Join(lines, " · ")
}

func engineVersion() string {
	out, err := runSpice("-v")
	if err != nil {
		return ""
	}
	if m := regexp.MustCompile(`\d+\.\d+\.\d+`).FindString(out); m != "" {
		return m
	}
	return ""
}

/* ---------------------------------------------------------------------- */
/* Downloads                                                               */
/* ---------------------------------------------------------------------- */

var httpClient = &http.Client{Timeout: 2 * time.Minute}

func httpGet(url string) (*http.Response, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Moggtify/"+AppVersion)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download failed – check your internet connection (%v)", err)
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("download failed: %s returned %s", url, resp.Status)
	}
	return resp, nil
}

func download(url, dst string) error {
	resp, err := httpGet(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	os.Remove(dst)
	return os.Rename(tmp, dst)
}

var semverRe = regexp.MustCompile(`v?(\d+\.\d+\.\d+)`)

// latestEngineVersion asks GitHub for the newest Spicetify release. If the
// API is rate limited it falls back to the redirect of the releases page.
func latestEngineVersion() (string, error) {
	if resp, err := httpGet(cliReleaseAPI); err == nil {
		defer resp.Body.Close()
		var rel struct {
			Tag string `json:"tag_name"`
		}
		if json.NewDecoder(resp.Body).Decode(&rel) == nil {
			if m := semverRe.FindStringSubmatch(rel.Tag); m != nil {
				return m[1], nil
			}
		}
	}
	noFollow := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequest("GET", cliLatestPage, nil)
	req.Header.Set("User-Agent", "Moggtify/"+AppVersion)
	resp, err := noFollow.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach GitHub – check your internet connection (%v)", err)
	}
	resp.Body.Close()
	if m := semverRe.FindStringSubmatch(resp.Header.Get("Location")); m != nil {
		return m[1], nil
	}
	return "", errors.New("could not determine the latest Spicetify version")
}

func newerVersion(a, b string) bool { // a > b
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func engineArch() string {
	switch runtime.GOARCH {
	case "arm64":
		return "arm64"
	case "386":
		return "x32"
	}
	return "x64"
}

// ensureEngine installs or upgrades Spicetify. It returns the version used
// and whether this call installed it from scratch.
func ensureEngine() (version string, fresh bool, err error) {
	current := ""
	if spiceExe() != "" {
		current = engineVersion()
	}
	latest, lerr := latestEngineVersion()
	if lerr != nil {
		if current != "" {
			return current, false, nil // offline but usable
		}
		return "", false, lerr
	}
	if current != "" && !newerVersion(latest, current) {
		return current, false, nil
	}
	zipPath := filepath.Join(os.TempDir(), "moggtify-spicetify.zip")
	defer os.Remove(zipPath)
	if err := download(fmt.Sprintf(cliDownloadFmt, latest, engineArch()), zipPath); err != nil {
		return "", false, err
	}
	if err := unzipTo(zipPath, spiceDir(), ""); err != nil {
		return "", false, fmt.Errorf("could not unpack the engine: %w", err)
	}
	return latest, current == "", nil
}

// installMarketplace mirrors the official Marketplace installer.
func installMarketplace() error {
	appDir := filepath.Join(spiceUserData(), "CustomApps", "marketplace")
	themeDir := filepath.Join(spiceUserData(), "Themes", "marketplace")
	zipPath := filepath.Join(os.TempDir(), "moggtify-marketplace.zip")
	defer os.Remove(zipPath)
	if err := download(marketplaceZip, zipPath); err != nil {
		return err
	}
	if err := removeAll(appDir); err != nil {
		return err
	}
	// The archive wraps everything in marketplace-dist/.
	if err := unzipTo(zipPath, appDir, "marketplace-dist/"); err != nil {
		return fmt.Errorf("could not unpack the Marketplace: %w", err)
	}
	if !exists(filepath.Join(appDir, "manifest.json")) {
		return errors.New("the Marketplace download looks incomplete (manifest.json missing)")
	}
	return download(marketplaceColor, filepath.Join(themeDir, "color.ini"))
}

func marketplaceInstalled() bool {
	return exists(filepath.Join(spiceUserData(), "CustomApps", "marketplace", "manifest.json"))
}

// unzipTo extracts src into dst. If strip is set, only entries under that
// prefix are extracted, with the prefix removed.
func unzipTo(src, dst, strip string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	root, _ := filepath.Abs(dst)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	for _, f := range r.File {
		name := strings.TrimLeft(strings.ReplaceAll(f.Name, "\\", "/"), "/")
		if strip != "" {
			if !strings.HasPrefix(name, strip) {
				continue
			}
			name = strings.TrimPrefix(name, strip)
		}
		name = path.Clean(name)
		if name == "" || name == "." {
			continue
		}
		target := filepath.Join(root, filepath.FromSlash(name))
		if !strings.HasPrefix(target, root+string(os.PathSeparator)) {
			return fmt.Errorf("invalid path in archive: %s", f.Name)
		}
		if f.FileInfo().IsDir() || strings.HasSuffix(f.Name, "/") {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		err = retry(4*time.Second, func() error {
			out, err := os.Create(target)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, rc)
			if cerr := out.Close(); err == nil {
				err = cerr
			}
			return err
		})
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

/* ---------------------------------------------------------------------- */
/* Spicetify config                                                        */
/* ---------------------------------------------------------------------- */

// readSpiceConfig parses config-xpui.ini into section -> key -> value.
func readSpiceConfig() map[string]map[string]string {
	out := map[string]map[string]string{}
	f, err := os.Open(spiceConfigFile())
	if err != nil {
		return out
	}
	defer f.Close()
	section := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.Trim(line, "[]")
			continue
		}
		if i := strings.Index(line, "="); i > 0 {
			if out[section] == nil {
				out[section] = map[string]string{}
			}
			out[section][strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	return out
}

func splitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, "|") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func spiceList(key string) []string {
	return splitList(readSpiceConfig()["AdditionalOptions"][key])
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// configArgs computes the `spicetify config` arguments that make the engine
// match cfg. Items Moggtify doesn't know about are left untouched.
func configArgs(cfg Config, currentExt, currentApps []string, currentTheme string) []string {
	args := []string{"config"}
	want := func(key string, items map[string]bool, current []string) {
		ids := make([]string, 0, len(items))
		for id := range items {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			on, has := items[id], contains(current, id)
			switch {
			case on && !has:
				args = append(args, key, id)
			case !on && has:
				args = append(args, key, id+"-")
			}
		}
	}
	exts := map[string]bool{}
	for id, on := range cfg.Extensions {
		exts[id] = on
	}
	exts[extrasFile] = true // the Moggtify hub ships with every install
	want("extensions", exts, currentExt)
	want("custom_apps", cfg.Apps, currentApps)
	args = append(args, "inject_css", "1", "replace_colors", "1", "inject_theme_js", "1", "check_spicetify_update", "0")
	if currentTheme == "" || currentTheme == "SpicetifyDefault" {
		// The Marketplace needs a placeholder theme so it can inject the
		// themes you pick in the store. Its colors are Spotify's own.
		args = append(args, "current_theme", "marketplace")
	}
	return args
}

// writeEngineConfig syncs Moggtify's choices into Spicetify.
func writeEngineConfig(cfg Config) error {
	if !exists(spiceConfigFile()) {
		// First run generates config-xpui.ini with auto-detected paths.
		if _, err := runSpice("-q"); err != nil && !exists(spiceConfigFile()) {
			return err
		}
	}
	extDir := filepath.Join(spiceUserData(), "Extensions")
	if err := os.MkdirAll(extDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(extDir, extrasFile), buildExtras(cfg), 0o644); err != nil {
		return err
	}
	ini := readSpiceConfig()
	args := configArgs(cfg,
		splitList(ini["AdditionalOptions"]["extensions"]),
		splitList(ini["AdditionalOptions"]["custom_apps"]),
		ini["Setting"]["current_theme"])
	// No -q here: config has no prompts and -q would hide its warnings.
	_, err := runSpice(args...)
	return err
}

/* ---------------------------------------------------------------------- */
/* High-level operations                                                   */
/* ---------------------------------------------------------------------- */

type Step struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

var (
	installSteps = []Step{
		{"app", "Install Moggtify"},
		{"detect", "Find Spotify"},
		{"engine", "Download engine"},
		{"market", "Install Marketplace"},
		{"config", "Set up extensions & designs"},
		{"close", "Close Spotify"},
		{"patch", "Patch Spotify"},
		{"launch", "Launch Spotify"},
	}
	repairSteps    = installSteps[1:]
	uninstallSteps = []Step{
		{"close", "Close Spotify"},
		{"restore", "Restore original Spotify"},
		{"engine", "Remove engine"},
		{"app", "Remove Moggtify"},
		{"launch", "Launch Spotify"},
	}
)

type progressFn func(step string, state string, detail string)

func noProgress(string, string, string) {}

func checkSpotify() error {
	info := detectSpotify()
	if info.Found {
		if info.Status == "missing" {
			return errors.New("Spotify looks damaged (its interface files are missing). Please reinstall Spotify.")
		}
		return nil
	}
	if info.Store {
		return errors.New("The Microsoft Store version of Spotify can't be modded. Uninstall it, install Spotify from spotify.com/download and run Moggtify again.")
	}
	return errors.New("Spotify isn't installed. Get it from spotify.com/download, sign in once, then run Moggtify again.")
}

// setupAll installs/updates the engine and Marketplace, syncs the config and
// patches Spotify. It's used for the first install and every re-apply.
//
// launchAlways starts Spotify at the end even if it wasn't running (the
// loader); otherwise Spotify only comes back if it was open (the watcher).
func setupAll(cfg *Config, p progressFn, launchAlways bool) error {
	if p == nil {
		p = noProgress
	}
	p("detect", "run", "")
	if err := checkSpotify(); err != nil {
		return err
	}
	p("detect", "done", "Spotify "+detectSpotify().Version)

	p("engine", "run", "")
	// Only claim the engine (and delete it on uninstall) if nothing of
	// Spicetify existed before – never take someone's own setup with us.
	hadSpicetify := spiceExe() != "" || exists(spiceUserData())
	ver, fresh, err := ensureEngine()
	if err != nil {
		return err
	}
	if fresh && !hadSpicetify {
		cfg.EngineOwned = true
	}
	p("engine", "done", "v"+ver)

	p("market", "run", "")
	if err := installMarketplace(); err != nil {
		if !marketplaceInstalled() {
			return err
		}
		p("market", "done", "kept existing")
	} else {
		p("market", "done", "latest")
	}

	p("config", "run", "")
	if err := writeEngineConfig(*cfg); err != nil {
		return err
	}
	p("config", "done", "")

	return patch(p, launchAlways)
}

// patch runs backup/apply depending on Spotify's current state.
func patch(p progressFn, launchAlways bool) error {
	if p == nil {
		p = noProgress
	}
	p("close", "run", "")
	wasRunning := closeSpotify()
	p("close", "done", "")

	p("patch", "run", "")
	var err error
	if exists(spaPath()) {
		// Vanilla client (first install or Spotify just updated).
		_, err = runSpice("backup", "apply", "-q", "--no-restart")
	} else {
		_, err = runSpice("apply", "-q", "--no-restart")
	}
	if err != nil {
		return err
	}
	if s := patchStatus(); s != "patched" {
		return fmt.Errorf("Spotify could not be patched (state: %s). Try again after Spotify fully started once.", s)
	}
	p("patch", "done", "")

	p("launch", "run", "")
	if !launchAlways && !wasRunning {
		p("launch", "done", "skipped")
		return nil
	}
	if err := startSpotify(); err != nil {
		p("launch", "done", "start it manually")
		return nil
	}
	p("launch", "done", "")
	return nil
}

// restoreVanilla removes every Spicetify modification from Spotify.
func restoreVanilla() error {
	switch patchStatus() {
	case "clean", "missing":
		return nil
	case "outdated":
		// A Spotify update already put a fresh, vanilla client in place; only
		// the stale extracted folder is left. Restoring the (older) backup
		// would downgrade the interface, so just remove the leftovers.
		return removeAll(xpuiDir())
	}
	if spiceExe() != "" {
		if _, err := runSpice("restore", "-q", "--no-restart"); err != nil {
			return err
		}
	} else if bak := spiceBackupSpa(); bak != "" {
		// Engine gone but its backup is still there: put it back by hand.
		if err := copyFile(bak, spaPath()); err != nil {
			return err
		}
		if err := removeAll(xpuiDir()); err != nil {
			return err
		}
	} else {
		return errors.New("Spotify is modded but neither the engine nor a backup is left. Reinstall Spotify from spotify.com to get the original back.")
	}
	if s := patchStatus(); s != "clean" {
		return fmt.Errorf("Spotify could not be restored (state: %s). Close Spotify completely and try again.", s)
	}
	return nil
}

// removeEngine deletes the Spicetify files Moggtify installed.
func removeEngine() {
	_ = removeAll(spiceDir())
	_ = removeAll(spiceUserData())
	_ = removeAll(spiceStateDir())
}
