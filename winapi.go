package main

import (
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                = windows.NewLazySystemDLL("user32.dll")
	dwmapi                = windows.NewLazySystemDLL("dwmapi.dll")
	shell32               = windows.NewLazySystemDLL("shell32.dll")
	procGetDpiForSystem   = user32.NewProc("GetDpiForSystem")
	procMessageBoxW       = user32.NewProc("MessageBoxW")
	procSetProcessDpiCtx  = user32.NewProc("SetProcessDpiAwarenessContext")
	procDwmSetWindowAttr  = dwmapi.NewProc("DwmSetWindowAttribute")
	procShellExecuteW     = shell32.NewProc("ShellExecuteW")
	procSetCurrentAppUMID = shell32.NewProc("SetCurrentProcessExplicitAppUserModelID")
)

func initDPI() {
	if procSetProcessDpiCtx.Find() == nil {
		procSetProcessDpiCtx.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
	}
	if procSetCurrentAppUMID.Find() == nil {
		id, _ := windows.UTF16PtrFromString("Moggtify.App")
		procSetCurrentAppUMID.Call(uintptr(unsafe.Pointer(id)))
	}
}

func dpiScale() float64 {
	if procGetDpiForSystem.Find() != nil {
		return 1
	}
	dpi, _, _ := procGetDpiForSystem.Call()
	if dpi == 0 {
		return 1
	}
	return float64(dpi) / 96
}

// styleWindow gives the native title bar the app's colors (Windows 11).
func styleWindow(hwnd uintptr) {
	if procDwmSetWindowAttr.Find() != nil || hwnd == 0 {
		return
	}
	set := func(attr uintptr, v uint32) {
		procDwmSetWindowAttr.Call(hwnd, attr, uintptr(unsafe.Pointer(&v)), 4)
	}
	set(20, 1)          // DWMWA_USE_IMMERSIVE_DARK_MODE
	set(35, 0x00100A0A) // DWMWA_CAPTION_COLOR  #0A0A10 (COLORREF = 0x00BBGGRR)
	set(36, 0x00F5F0F0) // DWMWA_TEXT_COLOR
	set(34, 0x00100A0A) // DWMWA_BORDER_COLOR
	set(33, 2)          // DWMWA_WINDOW_CORNER_PREFERENCE = round
}

func messageBox(title, text string, flags uintptr) int {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(text)
	r, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
	return int(r)
}

func openPath(p string) {
	verb, _ := windows.UTF16PtrFromString("open")
	target, _ := windows.UTF16PtrFromString(p)
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
}

func launchDetached(exe string, args ...string) {
	cmd := exec.Command(exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200}
	if cmd.Start() == nil {
		_ = cmd.Process.Release()
	}
}
