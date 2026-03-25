//go:build !windows

package instance

import "errors"

var ErrAlreadyRunning = errors.New("agent instance already running")

type Lock struct{}

func Acquire(_ string) (*Lock, error) {
	return &Lock{}, nil
}

func (lock *Lock) Release() error {
	return nil
}
