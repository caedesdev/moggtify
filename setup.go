package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

const (
	uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\Moggtify`
	runKey       = `Software\Microsoft\Windows\CurrentVersion\Run`
)

func currentExe() string {
	p, _ := os.Executable()
	p, _ = filepath.EvalSymlinks(p)
	return p
}

func isInstalledCopy() bool {
	return strings.EqualFold(filepath.Clean(currentExe()), filepath.Clean(installedExe()))
}

func appInstalled() bool { return exists(installedExe()) }

func startMenuShortcut() string {
	return filepath.Join(roamingAppData(), "Microsoft", "Windows", "Start Menu", "Programs", AppName+".lnk")
}

func desktopShortcut() string {
	h, _ := os.UserHomeDir()
	// Respect a relocated desktop (OneDrive etc.).
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`, registry.QUERY_VALUE); err == nil {
		defer k.Close()
		if v, _, err := k.GetStringValue("Desktop"); err == nil && v != "" {
			if x, err := registry.ExpandString(v); err == nil {
				v = x
			}
			return filepath.Join(v, AppName+".lnk")
		}
	}
	return filepath.Join(h, "Desktop", AppName+".lnk")
}

type InstallOptions struct {
	Desktop     bool `json:"desktop"`
	AutoReapply bool `json:"autoReapply"`
}

// installApp copies the running executable into the program folder and
// registers it with Windows (Start menu, Apps & Features, optional autostart).
// It is run by Install AND Repair, so the copy that autostarts (and keeps the
// mod alive after Spotify updates) is always the newest one.
func installApp(opts InstallOptions) error {
	if err := os.MkdirAll(installDir(), 0o755); err != nil {
		return err
	}
	cleanupOldExes()
	if !isInstalledCopy() {
		// The background helper runs from the installed copy; stop it so the
		// file can be replaced. activate() starts the new one afterwards.
		stopBackgroundWatcher()
		if err := replaceExe(currentExe(), installedExe()); err != nil {
			return fmt.Errorf("could not copy Moggtify: %w", err)
		}
	}
	_ = os.MkdirAll(dataDir(), 0o755)

	_ = createShortcut(startMenuShortcut(), installedExe())
	if opts.Desktop {
		_ = createShortcut(desktopShortcut(), installedExe())
	}

	k, _, err := registry.CreateKey(registry.CURRENT_USER, uninstallKey, registry.ALL_ACCESS)
	if err == nil {
		_ = k.SetStringValue("DisplayName", AppName)
		_ = k.SetStringValue("DisplayVersion", AppVersion)
		_ = k.SetStringValue("Publisher", AppName)
		_ = k.SetStringValue("DisplayIcon", installedExe()+",0")
		_ = k.SetStringValue("InstallLocation", installDir())
		_ = k.SetStringValue("UninstallString", `"`+installedExe()+`" --uninstall`)
		_ = k.SetStringValue("QuietUninstallString", `"`+installedExe()+`" --uninstall --quiet`)
		_ = k.SetDWordValue("NoModify", 1)
		_ = k.SetDWordValue("NoRepair", 1)
		if fi, err := os.Stat(installedExe()); err == nil {
			_ = k.SetDWordValue("EstimatedSize", uint32(fi.Size()/1024))
		}
		k.Close()
	}
	return setAutostart(opts.AutoReapply)
}

// replaceExe puts src at dst even if dst is still running: a running exe
// can't be overwritten or deleted on Windows, but it can be renamed aside.
func replaceExe(src, dst string) error {
	return retry(5*time.Second, func() error {
		err := copyFile(src, dst)
		if err == nil || !exists(dst) {
			return err
		}
		aside := fmt.Sprintf("%s.old-%d", dst, time.Now().UnixNano())
		if rerr := os.Rename(dst, aside); rerr != nil {
			return err
		}
		return copyFile(src, dst)
	})
}

// cleanupOldExes removes copies renamed aside by replaceExe once they are no
// longer running.
func cleanupOldExes() {
	old, _ := filepath.Glob(installedExe() + ".old-*")
	for _, f := range old {
		_ = os.Remove(f)
	}
}

func setAutostart(on bool) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if on && exists(installedExe()) {
		return k.SetStringValue(AppName, `"`+installedExe()+`" --background`)
	}
	err = k.DeleteValue(AppName)
	if err == registry.ErrNotExist {
		return nil
	}
	return err
}

// uninstallApp restores Spotify and removes every trace of Moggtify (and
// the Spicetify engine, if Moggtify was the one that installed it). The
// program folder itself is deleted after the process exits.
func uninstallApp(p progressFn) error {
	if p == nil {
		p = noProgress
	}
	cfg := loadConfig()
	cfg.Patched = false
	_ = saveConfig(cfg)
	stopBackgroundWatcher()

	p("close", "run", "")
	wasRunning := closeSpotify()
	p("close", "done", "")

	p("restore", "run", "")
	if err := restoreVanilla(); err != nil {
		return err
	}
	p("restore", "done", "")

	p("engine", "run", "")
	if cfg.EngineOwned {
		removeEngine()
		p("engine", "done", "removed")
	} else {
		p("engine", "done", "kept – it was there before Moggtify")
	}

	p("app", "run", "")
	_ = setAutostart(false)
	_ = registry.DeleteKey(registry.CURRENT_USER, uninstallKey)
	_ = os.Remove(startMenuShortcut())
	_ = os.Remove(desktopShortcut())
	_ = os.Remove(configPath())
	p("app", "done", "")

	p("launch", "run", "")
	if wasRunning {
		_ = startSpotify()
	}
	p("launch", "done", "")
	return nil
}

// scheduleDelete removes folders after this process has exited (a running
// exe and the WebView2 cache can't delete themselves).
func scheduleDelete(dirs ...string) {
	var parts []string
	for _, d := range dirs {
		if exists(d) {
			parts = append(parts, fmt.Sprintf(`rmdir /s /q "%s"`, d))
		}
	}
	if len(parts) == 0 {
		return
	}
	script := `ping 127.0.0.1 -n 3 >nul & ` + strings.Join(parts, " & ")
	cmd := exec.Command("cmd.exe", "/c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 | 0x00000008} // CREATE_NO_WINDOW | DETACHED_PROCESS
	_ = cmd.Start()
}

func createShortcut(lnk, target string) error {
	_ = os.MkdirAll(filepath.Dir(lnk), 0o755)
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	ps := fmt.Sprintf(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);$s.TargetPath=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;$s.Description='Spotify, unlocked.';$s.Save()`,
		q(lnk), q(target), q(filepath.Dir(target)), q(target+",0"))
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd.Run()
}
