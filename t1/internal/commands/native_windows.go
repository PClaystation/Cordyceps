//go:build windows

package commands

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

const (
	cfUnicodeText       = 13
	gmemMoveable        = 0x0002
	hwndBroadcast       = 0xffff
	wmSyscommand        = 0x0112
	scMonitorPower      = 0xF170
	monitorPowerOff     = 2
	keyeventfKeyup      = 0x0002
	sendMessageAbortIfHung = 0x0002
)

var (
	user32DLL                = syscall.NewLazyDLL("user32.dll")
	kernel32DLL              = syscall.NewLazyDLL("kernel32.dll")
	procKeybdEvent           = user32DLL.NewProc("keybd_event")
	procLockWorkStation      = user32DLL.NewProc("LockWorkStation")
	procOpenClipboard        = user32DLL.NewProc("OpenClipboard")
	procCloseClipboard       = user32DLL.NewProc("CloseClipboard")
	procEmptyClipboard       = user32DLL.NewProc("EmptyClipboard")
	procSetClipboardData     = user32DLL.NewProc("SetClipboardData")
	procSendMessageTimeoutW  = user32DLL.NewProc("SendMessageTimeoutW")
	procGlobalAlloc          = kernel32DLL.NewProc("GlobalAlloc")
	procGlobalLock           = kernel32DLL.NewProc("GlobalLock")
	procGlobalUnlock         = kernel32DLL.NewProc("GlobalUnlock")
)

func sendVirtualKey(vk uint16) error {
	if err := user32DLL.Load(); err != nil {
		return fmt.Errorf("load user32: %w", err)
	}

	procKeybdEvent.Call(uintptr(vk), 0, 0, 0)
	time.Sleep(20 * time.Millisecond)
	procKeybdEvent.Call(uintptr(vk), 0, keyeventfKeyup, 0)
	return nil
}

func lockWorkStationNative() error {
	if err := user32DLL.Load(); err != nil {
		return fmt.Errorf("load user32: %w", err)
	}

	result, _, callErr := procLockWorkStation.Call()
	if result == 0 {
		if callErr != syscall.Errno(0) {
			return callErr
		}
		return fmt.Errorf("lock workstation: unknown error")
	}

	return nil
}

func setClipboardText(text string) error {
	if err := user32DLL.Load(); err != nil {
		return fmt.Errorf("load user32: %w", err)
	}
	if err := kernel32DLL.Load(); err != nil {
		return fmt.Errorf("load kernel32: %w", err)
	}

	for attempt := 0; attempt < 5; attempt++ {
		opened, _, callErr := procOpenClipboard.Call(0)
		if opened != 0 {
			defer procCloseClipboard.Call()

			if emptied, _, emptyErr := procEmptyClipboard.Call(); emptied == 0 {
				if emptyErr != syscall.Errno(0) {
					return fmt.Errorf("empty clipboard: %w", emptyErr)
				}
				return fmt.Errorf("empty clipboard: unknown error")
			}

			utf16Text, err := syscall.UTF16FromString(text)
			if err != nil {
				return fmt.Errorf("encode clipboard text: %w", err)
			}

			sizeBytes := uintptr(len(utf16Text) * 2)
			handle, _, allocErr := procGlobalAlloc.Call(gmemMoveable, sizeBytes)
			if handle == 0 {
				if allocErr != syscall.Errno(0) {
					return fmt.Errorf("allocate clipboard memory: %w", allocErr)
				}
				return fmt.Errorf("allocate clipboard memory: unknown error")
			}

			mem, _, lockErr := procGlobalLock.Call(handle)
			if mem == 0 {
				if lockErr != syscall.Errno(0) {
					return fmt.Errorf("lock clipboard memory: %w", lockErr)
				}
				return fmt.Errorf("lock clipboard memory: unknown error")
			}

			copy((*[1 << 30]uint16)(unsafe.Pointer(mem))[:len(utf16Text):len(utf16Text)], utf16Text)
			procGlobalUnlock.Call(handle)

			setResult, _, setErr := procSetClipboardData.Call(cfUnicodeText, handle)
			if setResult == 0 {
				if setErr != syscall.Errno(0) {
					return fmt.Errorf("set clipboard data: %w", setErr)
				}
				return fmt.Errorf("set clipboard data: unknown error")
			}

			return nil
		}

		if callErr != syscall.Errno(0) && attempt == 4 {
			return fmt.Errorf("open clipboard: %w", callErr)
		}

		time.Sleep(25 * time.Millisecond)
	}

	return fmt.Errorf("open clipboard: timed out waiting for access")
}

func turnDisplayOffNative() error {
	if err := user32DLL.Load(); err != nil {
		return fmt.Errorf("load user32: %w", err)
	}

	result, _, callErr := procSendMessageTimeoutW.Call(
		hwndBroadcast,
		wmSyscommand,
		scMonitorPower,
		monitorPowerOff,
		sendMessageAbortIfHung,
		uintptr((commandTimeout/time.Millisecond)+250),
		0,
	)
	if result == 0 && callErr != syscall.Errno(0) {
		return callErr
	}

	return nil
}
