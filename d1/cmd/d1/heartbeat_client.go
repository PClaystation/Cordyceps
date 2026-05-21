package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/charliearnerstal/cordyceps/d1/internal/background"
	"github.com/charliearnerstal/cordyceps/d1/internal/resilience"
)

func ensureHeartbeatPresentAndRunning(agentExecutablePath string, paths resilience.Paths) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	heartbeatTarget := resilience.HeartbeatExecutablePath(paths)
	missing, err := resilience.MissingOrInvalidExecutable(heartbeatTarget)
	if err != nil {
		return err
	}
	if missing {
		staged, stageErr := stageBundledExecutableIfPresent(bundledHeartbeatName, heartbeatTarget)
		if stageErr != nil {
			return fmt.Errorf("install heartbeat executable from bundle: %w", stageErr)
		}
		if !staged {
			sourcePath, sourceErr := discoverHeartbeatSource(agentExecutablePath)
			if sourceErr != nil {
				return sourceErr
			}
			if sourcePath != "" {
				if err := resilience.CopyExecutable(sourcePath, heartbeatTarget); err != nil {
					return fmt.Errorf("install heartbeat executable: %w", err)
				}
			}
		}
	}

	missing, err = resilience.MissingOrInvalidExecutable(heartbeatTarget)
	if err != nil {
		return err
	}
	if missing {
		return fmt.Errorf("heartbeat executable is missing at %s", heartbeatTarget)
	}

	return background.RelaunchDetached(heartbeatTarget, []string{
		"--config", paths.ConfigPath,
		"--startup",
	})
}

func discoverHeartbeatSource(agentExecutablePath string) (string, error) {
	baseDir := filepath.Dir(strings.TrimSpace(agentExecutablePath))
	candidates := []string{
		filepath.Join(baseDir, "d1-heartbeat.exe"),
		filepath.Join(baseDir, "dist", "d1-heartbeat.exe"),
		filepath.Join(baseDir, "..", "d1heartbeat", "d1-heartbeat.exe"),
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Clean(candidate), nil
		}
	}

	return "", nil
}
