package main

import (
	"errors"
	"runtime"
	"time"

	"golang.org/x/sys/windows"
)

// engineLock serialises everything that runs Spicetify or touches Spotify's
// files across processes: the loader window and the background watcher must
// never patch at the same time.
const engineMutex = `Local\MoggtifyEngine`

var errEngineBusy = errors.New("Moggtify is already working on Spotify in the background – try again in a minute.")

func withEngineLock(timeout time.Duration, fn func() error) error {
	// A Windows mutex belongs to the OS thread that acquired it, so keep this
	// goroutine on one thread until it is released again.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	name, _ := windows.UTF16PtrFromString(engineMutex)
	h, err := windows.CreateMutex(nil, false, name)
	if h == 0 {
		return err
	}
	defer windows.CloseHandle(h)
	ev, err := windows.WaitForSingleObject(h, uint32(timeout/time.Millisecond))
	switch ev {
	case windows.WAIT_OBJECT_0, windows.WAIT_ABANDONED:
		defer windows.ReleaseMutex(h)
		return fn()
	case uint32(windows.WAIT_TIMEOUT):
		return errEngineBusy
	}
	if err == nil {
		err = errEngineBusy
	}
	return err
}
