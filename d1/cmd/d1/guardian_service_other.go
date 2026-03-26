//go:build !windows

package main

import "github.com/charliearnerstal/jarvis/d1/internal/resilience"

func ensureGuardianWindowsServiceRunning(_ string, _ resilience.Paths) (bool, error) {
	return false, nil
}
