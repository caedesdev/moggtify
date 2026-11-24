package main

import (
	"embed"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

//go:embed runtime ui
var assets embed.FS

func hasFlag(name string) bool {
	for _, a := range os.Args[1:] {
		if strings.EqualFold(a, name) {
			return true
		}
	}
	return false
}

func main() {
	runtime.LockOSThread()

	switch {
	case hasFlag("--dump-extension"):
		// Dev helper: write the in-Spotify bundle (moggtify.js) for previews.
		out := "dist/moggtify.js"
		for i, a := range os.Args {
			if strings.EqualFold(a, "--dump-extension") && i+1 < len(os.Args) {
				out = os.Args[i+1]
			}
		}
		_ = os.MkdirAll(filepath.Dir(out), 0o755)
		if err := os.WriteFile(out, buildExtras(defaultConfig()), 0o644); err != nil {
			os.Exit(1)
		}
	case hasFlag("--background"):
		runBackgroundWatcher()
	case hasFlag("--uninstall") && hasFlag("--quiet"):
		if err := withEngineLock(2*time.Minute, func() error { return uninstallApp(nil) }); err == nil {
			scheduleDelete(installDir(), dataDir())
		}
	case hasFlag("--uninstall"):
		runGUI("uninstall")
	default:
		runGUI("")
	}
}

func runGUI(mode string) {
	// Only one window at a time - focus the existing one instead.
	name, _ := windows.UTF16PtrFromString(`Local\MoggtifyApp`)
	m, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		focusExisting()
		return
	}
	if m != 0 {
		defer windows.CloseHandle(m)
	}

	initDPI()
	_ = os.MkdirAll(dataDir(), 0o755)
	os.Setenv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF0A0A10")

	s := dpiScale()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     os.Getenv("MOGG_DEBUG") != "",
		AutoFocus: true,
		DataPath:  webviewDataDir(),
		WindowOptions: webview2.WindowOptions{
			Title:  AppName,
			Width:  uint(1040 * s),
			Height: uint(680 * s),
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		if messageBox(AppName, "Moggtify braucht die Microsoft Edge WebView2 Runtime.\n\nJetzt die Download-Seite öffnen?", 0x04|0x40) == 6 {
			openPath("https://developer.microsoft.com/microsoft-edge/webview2/")
		}
		return
	}
	defer w.Destroy()

	styleWindow(uintptr(w.Window()))
	w.SetSize(int(900*s), int(600*s), webview2.HintMin)

	app := &App{w: w, mode: mode}
	app.bind()

	html, _ := assets.ReadFile("ui/index.html")
	w.SetHtml(string(html))
	w.Run()

	if app.deleteOnExit {
		scheduleDelete(installDir(), dataDir())
	}
}

func focusExisting() {
	findWindow := user32.NewProc("FindWindowW")
	setFg := user32.NewProc("SetForegroundWindow")
	showWin := user32.NewProc("ShowWindow")
	cls, _ := windows.UTF16PtrFromString("webview")
	title, _ := windows.UTF16PtrFromString(AppName)
	h, _, _ := findWindow.Call(uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)))
	if h != 0 {
		showWin.Call(h, 9) // SW_RESTORE
		setFg.Call(h)
	}
}
