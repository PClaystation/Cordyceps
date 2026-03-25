//go:build !windows

package main

import "fmt"

func handleWindowsService(opts agentOptions) (bool, error) {
	if opts.installService || opts.uninstallSvc || opts.interactiveSvc {
		return true, fmt.Errorf("Windows service mode is only available on Windows")
	}

	return false, nil
}

func repairWindowsServiceIfInstalled() error {
	return nil
}
