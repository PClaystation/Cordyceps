//go:build !windows

package commands

import "errors"

func sendVirtualKey(_ uint16) error {
	return errors.New("native keyboard injection is supported only on Windows")
}

func lockWorkStationNative() error {
	return errors.New("native lock workstation is supported only on Windows")
}

func setClipboardText(_ string) error {
	return errors.New("native clipboard control is supported only on Windows")
}

func turnDisplayOffNative() error {
	return errors.New("native display control is supported only on Windows")
}
