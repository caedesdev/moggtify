package main

import (
	"encoding/json"
	"errors"
	"sync/atomic"
	"time"

	"github.com/jchv/go-webview2"
)

// App is the bridge between the loader window and the engine. The loader
// does exactly three things – install, repair, delete – everything else
// lives inside Spotify (the Moggtify button next to the profile picture).
//
// Bridge contract (window.mogg_*):
//
//	mogg_state()      -> State
//	mogg_install()    -> starts op "install"
//	mogg_repair()     -> starts op "repair"
//	mogg_uninstall()  -> starts op "uninstall"
//	mogg_open(kind)   -> opens "download" | "spicetify" | "repo"
//	mogg_quit()       -> closes the window
//
// Events (window.__mogg(name, payload)):
//
//	progress {op, step, state: "run"|"done", detail}
//	done     {op, state: State}
//	error    {op, message, state: State}
type App struct {
	w            webview2.WebView
	mode         string
	busy         atomic.Bool
	deleteOnExit bool
}

type State struct {
	Version   string            `json:"version"`
	Mode      string            `json:"mode"`      // "" or "uninstall" (opened from Windows settings)
	Spotify   SpotifyInfo       `json:"spotify"`   // found, store, version, running, status
	Installed bool              `json:"installed"` // Moggtify is installed on this PC
	Active    bool              `json:"active"`    // Spotify is currently modded
	Engine    EngineInfo        `json:"engine"`
	Config    Config            `json:"config"`
	Busy      bool              `json:"busy"`
	Steps     map[string][]Step `json:"steps"` // install | repair | uninstall
	Repo      string            `json:"repo"`
}

type EngineInfo struct {
	Installed   bool `json:"installed"`
	Marketplace bool `json:"marketplace"`
}

func (a *App) state() State {
	sp := detectSpotify()
	return State{
		Version:   AppVersion,
		Mode:      a.mode,
		Spotify:   sp,
		Installed: appInstalled(),
		Active:    sp.Status == "patched",
		Engine:    EngineInfo{Installed: spiceExe() != "", Marketplace: marketplaceInstalled()},
		Config:    loadConfig(),
		Busy:      a.busy.Load(),
		Steps:     map[string][]Step{"install": installSteps, "repair": repairSteps, "uninstall": uninstallSteps},
		Repo:      RepoURL,
	}
}

func (a *App) emit(name string, payload any) {
	n, _ := json.Marshal(name)
	b, _ := json.Marshal(payload)
	a.w.Dispatch(func() {
		a.w.Eval("window.__mogg&&window.__mogg(" + string(n) + "," + string(b) + ")")
	})
}

// run executes fn in the background, guarding against parallel operations.
func (a *App) run(op string, fn func(p progressFn) error) error {
	if !a.busy.CompareAndSwap(false, true) {
		return errors.New("Hang on – something is already running.")
	}
	go func() {
		defer a.busy.Store(false)
		progress := func(step, st, detail string) {
			a.emit("progress", map[string]string{"op": op, "step": step, "state": st, "detail": detail})
		}
		err := fn(progress)
		time.Sleep(150 * time.Millisecond)
		if err != nil {
			a.emit("error", map[string]any{"op": op, "message": err.Error(), "state": a.state()})
			return
		}
		a.emit("done", map[string]any{"op": op, "state": a.state()})
	}()
	return nil
}

// activate runs the full setup and remembers that Spotify should stay modded.
func activate(cfg *Config, p progressFn) error {
	err := withEngineLock(2*time.Minute, func() error { return setupAll(cfg, p, true) })
	if err == nil {
		cfg.Patched = true
	}
	_ = saveConfig(*cfg) // keeps EngineOwned even when a later step failed
	if err == nil && cfg.AutoReapply {
		startBackgroundWatcher()
	}
	return err
}

func (a *App) bind() {
	must := func(err error) {
		if err != nil {
			panic(err)
		}
	}

	must(a.w.Bind("mogg_state", func() State { return a.state() }))

	// Install: the app itself, the engine, the Marketplace and the mod.
	must(a.w.Bind("mogg_install", func() error {
		return a.run("install", func(p progressFn) error {
			cfg := loadConfig()
			cfg.AutoReapply = true
			cfg.Rev = time.Now().UnixMilli()
			p("app", "run", "")
			if err := saveConfig(cfg); err != nil {
				return err
			}
			if err := installApp(InstallOptions{Desktop: true, AutoReapply: true}); err != nil {
				return err
			}
			p("app", "done", "")
			return activate(&cfg, p)
		})
	}))

	// Repair: newest engine + Marketplace, re-sync, re-patch. Also the fix
	// after a Spotify update. It refreshes the installed copy too, so the
	// background helper that keeps the mod alive is always the newest one.
	must(a.w.Bind("mogg_repair", func() error {
		return a.run("repair", func(p progressFn) error {
			cfg := loadConfig()
			cfg.AutoReapply = true
			cfg.Rev = time.Now().UnixMilli()
			if err := installApp(InstallOptions{Desktop: exists(desktopShortcut()), AutoReapply: true}); err != nil {
				return err
			}
			return activate(&cfg, p)
		})
	}))

	// Delete: restore Spotify and remove Moggtify from this PC.
	must(a.w.Bind("mogg_uninstall", func() error {
		return a.run("uninstall", func(p progressFn) error {
			if err := withEngineLock(2*time.Minute, func() error { return uninstallApp(p) }); err != nil {
				return err
			}
			a.deleteOnExit = true
			return nil
		})
	}))

	must(a.w.Bind("mogg_open", func(kind string) {
		switch kind {
		case "download":
			openPath("https://www.spotify.com/download/windows/")
		case "spicetify":
			openPath("https://spicetify.app/")
		case "repo":
			openPath(RepoURL)
		}
	}))

	must(a.w.Bind("mogg_quit", func() { a.w.Terminate() }))
}
