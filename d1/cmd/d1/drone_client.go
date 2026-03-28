package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/charliearnerstal/jarvis/d1/internal/background"
	"github.com/charliearnerstal/jarvis/d1/internal/config"
	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
)

func ensureRestoreDronesPresentAndRunning(agentExecutablePath string, paths resilience.Paths) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	targetCount := 5
	if cfg, err := config.Load(paths.ConfigPath); err == nil {
		targetCount = config.NormalizeDroneTargetCount(cfg.DroneTargetCount)
	}

	for _, role := range resilience.DroneRoles() {
		if int(resilience.NormalizeDroneRole(role)[0]-'0') > targetCount {
			continue
		}
		if err := ensureRestoreDronePresentAndRunning(agentExecutablePath, paths, role); err != nil {
			return err
		}
	}

	return nil
}

func ensureRestoreDronePresentAndRunning(agentExecutablePath string, paths resilience.Paths, role string) error {
	targetPath := resilience.DroneExecutablePath(paths, role)
	backupPath := resilience.DroneBackupExecutablePath(paths, role)

	liveMissing, err := resilience.MissingOrInvalidExecutable(targetPath)
	if err != nil {
		return err
	}
	backupMissing, err := resilience.MissingOrInvalidExecutable(backupPath)
	if err != nil {
		return err
	}

	sourcePath := ""
	if liveMissing || backupMissing {
		sourcePath, err = discoverRestoreDroneSource(agentExecutablePath, paths, role)
		if err != nil {
			return err
		}
		if sourcePath == "" {
			return fmt.Errorf("restore drone %s executable source is missing", role)
		}
	}

	if liveMissing {
		if err := resilience.CopyExecutable(sourcePath, targetPath); err != nil {
			return fmt.Errorf("install drone %s executable: %w", role, err)
		}
	}
	if backupMissing {
		if err := resilience.CopyExecutable(sourcePath, backupPath); err != nil {
			return fmt.Errorf("seed drone %s backup: %w", role, err)
		}
	}

	missing, err := resilience.MissingOrInvalidExecutable(targetPath)
	if err != nil {
		return err
	}
	if missing {
		return fmt.Errorf("drone %s executable is missing at %s", role, targetPath)
	}

	return background.RelaunchDetached(targetPath, []string{
		"--config", paths.ConfigPath,
		"--install-root", paths.InstallRoot,
		"--program-data-root", paths.ProgramDataRoot,
		"--role", resilience.NormalizeDroneRole(role),
	})
}

func discoverRestoreDroneSource(agentExecutablePath string, paths resilience.Paths, role string) (string, error) {
	baseDir := filepath.Dir(strings.TrimSpace(agentExecutablePath))
	normalizedRole := resilience.NormalizeDroneRole(role)
	fileName := "d1-drone-" + normalizedRole + ".exe"
	candidates := []string{
		filepath.Join(baseDir, fileName),
		filepath.Join(baseDir, "dist", fileName),
		filepath.Join(baseDir, "d1-drone.exe"),
		filepath.Join(baseDir, "dist", "d1-drone.exe"),
		filepath.Join(baseDir, "..", "d1drone", fileName),
		filepath.Join(baseDir, "..", "d1drone", "d1-drone.exe"),
		resilience.DroneExecutablePath(paths, normalizedRole),
		resilience.DroneBackupExecutablePath(paths, normalizedRole),
		resilience.DroneTemplatePath(paths, normalizedRole),
		resilience.DroneColdSparePath(paths),
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Clean(candidate), nil
		}
	}

	return "", nil
}
