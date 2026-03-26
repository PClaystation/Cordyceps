//go:build !windows

package main

import "github.com/charliearnerstal/jarvis/d1/internal/resilience"

func ensureWindowsPersistenceServices(_ agentOptions, _ resilience.Paths, _ bool, _ string) (bool, error) {
	return false, nil
}
