//go:build !windows

package main

import "fmt"

func handleGuardianWindowsService(opts guardianOptions) (bool, error) {
	if opts.installService || opts.uninstallSvc || opts.interactiveSvc {
		return true, fmt.Errorf("Windows service mode is only available on Windows")
	}

	return false, nil
}

func repairGuardianWindowsServiceIfInstalled() error {
	return nil
}
