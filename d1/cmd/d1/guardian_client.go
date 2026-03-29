package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/charliearnerstal/jarvis/d1/internal/background"
	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
)

func ensureGuardianPresentAndRunning(agentExecutablePath string, paths resilience.Paths) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	guardianTarget := resilience.GuardianExecutablePath(paths)
	missing, err := resilience.MissingOrInvalidExecutable(guardianTarget)
	if err != nil {
		return err
	}
	if missing {
		staged, stageErr := stageBundledExecutableIfPresent(bundledGuardianName, guardianTarget)
		if stageErr != nil {
			return fmt.Errorf("install guardian executable from bundle: %w", stageErr)
		}
		if !staged {
			sourcePath, sourceErr := discoverGuardianSource(agentExecutablePath)
			if sourceErr != nil {
				return sourceErr
			}
			if sourcePath != "" {
				if err := resilience.CopyExecutable(sourcePath, guardianTarget); err != nil {
					return fmt.Errorf("install guardian executable: %w", err)
				}
			}
		}
	}

	missing, err = resilience.MissingOrInvalidExecutable(guardianTarget)
	if err != nil {
		return err
	}
	if missing {
		return fmt.Errorf("guardian executable is missing at %s", guardianTarget)
	}

	if installedAsService, err := ensureGuardianWindowsServiceRunning(guardianTarget, paths); err != nil {
		return err
	} else if installedAsService {
		return nil
	}

	return background.RelaunchDetached(guardianTarget, []string{
		"--config", paths.ConfigPath,
		"--install-root", paths.InstallRoot,
		"--program-data-root", paths.ProgramDataRoot,
		"--startup",
	})
}

func discoverGuardianSource(agentExecutablePath string) (string, error) {
	baseDir := filepath.Dir(strings.TrimSpace(agentExecutablePath))
	candidates := []string{
		filepath.Join(baseDir, "d1-guardian.exe"),
		filepath.Join(baseDir, "dist", "d1-guardian.exe"),
		filepath.Join(baseDir, "..", "d1guardian", "d1-guardian.exe"),
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Clean(candidate), nil
		}
	}

	return "", nil
}
