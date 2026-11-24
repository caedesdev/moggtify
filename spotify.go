package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type SpotifyInfo struct {
	Found   bool   `json:"found"`
	Store   bool   `json:"store"`
	Dir     string `json:"dir"`
	Exe     string `json:"exe"`
	Version string `json:"version"`
	Running bool   `json:"running"`
	Status  string `json:"status"` // clean | patched | outdated | missing
}

func spotifyDir() string {
	if v := os.Getenv("MOGG_SPOTIFY_DIR"); v != "" { // tests / portable installs
		return v
	}
	return filepath.Join(roamingAppData(), "Spotify")
}
func spotifyExe() string { return filepath.Join(spotifyDir(), "Spotify.exe") }
func appsDir() string    { return filepath.Join(spotifyDir(), "Apps") }
func spaPath() string    { return filepath.Join(appsDir(), "xpui.spa") }
func xpuiDir() string    { return filepath.Join(appsDir(), "xpui") }

func detectSpotify() SpotifyInfo {
	info := SpotifyInfo{Dir: spotifyDir(), Exe: spotifyExe()}
	if exists(info.Exe) {
		info.Found = true
		info.Version = fileVersion(info.Exe)
	} else {
		// Microsoft Store builds live in a sealed WindowsApps folder we can't patch.
		store := filepath.Join(localAppData(), "Microsoft", "WindowsApps", "Spotify.exe")
		if exists(store) {
			info.Store = true
		}
	}
	info.Running = len(spotifyPIDs()) > 0
	info.Status = patchStatus()
	return info
}

// patchStatus reports what state Spotify's interface files are in.
//
//	clean    – vanilla (xpui.spa present, nothing extracted)
//	patched  – Spicetify applied
//	outdated – patched before, but a Spotify update put a fresh xpui.spa back
//	missing  – neither found
func patchStatus() string {
	spa := exists(spaPath())
	idx, err := os.ReadFile(filepath.Join(xpuiDir(), "index.html"))
	modded := err == nil && strings.Contains(strings.ToLower(string(idx)), "spicetify")
	switch {
	case modded && !spa:
		return "patched"
	case spa && err == nil:
		return "outdated"
	case spa:
		return "clean"
	case err == nil:
		return "patched" // extracted by another tool; Spicetify can take over
	default:
		return "missing"
	}
}

/* ---- processes ---- */

// noProcessControl disables killing/starting Spotify (used by tests so a
// real running Spotify is never touched).
var noProcessControl bool

func spotifyPIDs() []uint32 {
	if noProcessControl {
		return nil
	}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	var pids []uint32
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		if strings.EqualFold(windows.UTF16ToString(pe.ExeFile[:]), "Spotify.exe") {
			pids = append(pids, pe.ProcessID)
		}
	}
	return pids
}

// closeSpotify terminates every Spotify process and waits until they're gone.
func closeSpotify() (wasRunning bool) {
	pids := spotifyPIDs()
	if len(pids) == 0 {
		return false
	}
	for attempt := 0; attempt < 3; attempt++ {
		for _, pid := range spotifyPIDs() {
			h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.SYNCHRONIZE, false, pid)
			if err != nil {
				continue
			}
			_ = windows.TerminateProcess(h, 0)
			windows.WaitForSingleObject(h, 3000)
			windows.CloseHandle(h)
		}
		if len(spotifyPIDs()) == 0 {
			break
		}
		time.Sleep(400 * time.Millisecond)
	}
	time.Sleep(350 * time.Millisecond)
	return true
}

func startSpotify() error {
	if noProcessControl {
		return nil
	}
	if !exists(spotifyExe()) {
		return fmt.Errorf("Spotify.exe not found")
	}
	cmd := exec.Command(spotifyExe())
	cmd.Dir = spotifyDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200} // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

/* ---- version info ---- */

func fileVersion(path string) string {
	size, err := windows.GetFileVersionInfoSize(path, nil)
	if err != nil || size == 0 {
		return ""
	}
	buf := make([]byte, size)
	if err := windows.GetFileVersionInfo(path, 0, size, unsafe.Pointer(&buf[0])); err != nil {
		return ""
	}
	var fixed *windows.VS_FIXEDFILEINFO
	var l uint32
	if err := windows.VerQueryValue(unsafe.Pointer(&buf[0]), `\`, unsafe.Pointer(&fixed), &l); err != nil || fixed == nil {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d.%d",
		fixed.FileVersionMS>>16, fixed.FileVersionMS&0xffff,
		fixed.FileVersionLS>>16, fixed.FileVersionLS&0xffff)
}
