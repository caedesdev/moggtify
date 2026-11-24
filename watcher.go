package main

import (
	"time"

	"golang.org/x/sys/windows"
)

// The background watcher starts at login (--background). It sleeps almost
// all the time and re-applies everything when a Spotify update replaced the
// modded client with a fresh one.

const (
	watcherMutex = `Local\MoggtifyWatcher`
	watcherStop  = `Local\MoggtifyWatcherStop`
)

func runBackgroundWatcher() {
	name, _ := windows.UTF16PtrFromString(watcherMutex)
	m, err := windows.CreateMutex(nil, false, name)
	if err != nil { // includes ERROR_ALREADY_EXISTS
		return
	}
	defer windows.CloseHandle(m)

	stopName, _ := windows.UTF16PtrFromString(watcherStop)
	stop, err := windows.CreateEvent(nil, 1, 0, stopName)
	if err != nil {
		return
	}
	defer windows.CloseHandle(stop)

	lastAttempt := time.Time{}
	check := func() bool {
		cfg := loadConfig()
		if !cfg.AutoReapply || !cfg.Patched {
			return false // turned off or restored – nothing to watch
		}
		status := patchStatus()
		if (status == "clean" || status == "outdated") && time.Since(lastAttempt) > 10*time.Minute {
			lastAttempt = time.Now()
			// Let a running updater finish writing files first.
			time.Sleep(5 * time.Second)
			wasRunning := len(spotifyPIDs()) > 0
			err := withEngineLock(time.Second, func() error {
				// Re-check under the lock: the loader may have just fixed it.
				if st := patchStatus(); st != "clean" && st != "outdated" {
					return nil
				}
				return setupAll(&cfg, nil, false)
			})
			if err == nil {
				_ = saveConfig(cfg)
			} else if wasRunning && len(spotifyPIDs()) == 0 {
				_ = startSpotify() // never leave the user without music
			}
		}
		return true
	}

	if !check() {
		return
	}
	for {
		ev, _ := windows.WaitForSingleObject(stop, 30000)
		if ev == windows.WAIT_OBJECT_0 {
			return
		}
		if !check() {
			return
		}
	}
}

func stopBackgroundWatcher() {
	name, _ := windows.UTF16PtrFromString(watcherStop)
	h, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, name)
	if err != nil {
		return
	}
	_ = windows.SetEvent(h)
	windows.CloseHandle(h)
}

func startBackgroundWatcher() {
	if !exists(installedExe()) {
		return
	}
	launchDetached(installedExe(), "--background")
}
