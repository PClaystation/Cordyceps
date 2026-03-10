//go:build windows

package instance

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"syscall"
	"unsafe"
)

const errorAlreadyExists syscall.Errno = 183

var ErrAlreadyRunning = errors.New("agent instance already running")

type Lock struct {
	handle syscall.Handle
}

func Acquire(scope string) (*Lock, error) {
	name := mutexName(scope)
	nameUTF16, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return nil, fmt.Errorf("encode mutex name: %w", err)
	}

	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	createMutex := kernel32.NewProc("CreateMutexW")
	if err := kernel32.Load(); err != nil {
		return nil, fmt.Errorf("load kernel32: %w", err)
	}

	handle, _, callErr := createMutex.Call(0, 0, uintptr(unsafe.Pointer(nameUTF16)))
	if handle == 0 {
		if callErr != syscall.Errno(0) {
			return nil, fmt.Errorf("create mutex: %w", callErr)
		}
		return nil, fmt.Errorf("create mutex: unknown error")
	}

	if callErr == errorAlreadyExists {
		_ = syscall.CloseHandle(syscall.Handle(handle))
		return nil, ErrAlreadyRunning
	}

	return &Lock{handle: syscall.Handle(handle)}, nil
}

func (lock *Lock) Release() error {
	if lock == nil || lock.handle == 0 {
		return nil
	}

	err := syscall.CloseHandle(lock.handle)
	lock.handle = 0
	if err != nil {
		return fmt.Errorf("close mutex handle: %w", err)
	}

	return nil
}

func mutexName(scope string) string {
	sum := sha1.Sum([]byte(scope))
	return "Local\\E1Agent-" + hex.EncodeToString(sum[:])
}
