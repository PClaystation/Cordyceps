//go:build !windows

package main

import "github.com/charliearnerstal/cordyceps/d1/internal/resilience"

func ensureGuardianWindowsServiceRunning(_ string, _ resilience.Paths) (bool, error) {
	return false, nil
}
