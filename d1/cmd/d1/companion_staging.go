package main

import (
	"errors"
	"fmt"
	"runtime"
	"strings"

	"github.com/charliearnerstal/cordyceps/d1/internal/resilience"
)

func stageManagedCompanionsIfPresent(agentExecutablePath string, paths resilience.Paths) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	var errs []error

	if err := stageExecutableIfPresent(agentExecutablePath, resilience.GuardianExecutablePath(paths), bundledGuardianName, discoverGuardianSource); err != nil {
		errs = append(errs, fmt.Errorf("stage guardian executable: %w", err))
	}
	if err := stageExecutableIfPresent(agentExecutablePath, resilience.HeartbeatExecutablePath(paths), bundledHeartbeatName, discoverHeartbeatSource); err != nil {
		errs = append(errs, fmt.Errorf("stage heartbeat executable: %w", err))
	}

	for _, role := range resilience.DroneRoles() {
		if err := stageRestoreDroneArtifactsIfPresent(agentExecutablePath, paths, role); err != nil {
			errs = append(errs, fmt.Errorf("stage drone %s artifacts: %w", resilience.NormalizeDroneRole(role), err))
		}
	}

	return errors.Join(errs...)
}

func stageExecutableIfPresent(
	agentExecutablePath string,
	targetPath string,
	bundledFileName string,
	discover func(string) (string, error),
) error {
	if staged, err := stageBundledExecutableIfPresent(bundledFileName, targetPath); err != nil {
		return err
	} else if staged {
		return nil
	}

	sourcePath, err := discover(agentExecutablePath)
	if err != nil {
		return err
	}
	if strings.TrimSpace(sourcePath) == "" || sameWindowsPath(sourcePath, targetPath) {
		return nil
	}
	return resilience.CopyExecutable(sourcePath, targetPath)
}

func stageRestoreDroneArtifactsIfPresent(agentExecutablePath string, paths resilience.Paths, role string) error {
	if staged, err := stageBundledDroneArtifactsIfPresent(paths, role); err != nil {
		return err
	} else if staged {
		return nil
	}

	sourcePath, err := discoverRestoreDroneSource(agentExecutablePath, paths, role)
	if err != nil {
		return err
	}
	if strings.TrimSpace(sourcePath) == "" {
		return nil
	}

	destinations := []string{
		resilience.DroneExecutablePath(paths, role),
		resilience.DroneTemplatePath(paths, role),
	}
	destinations = append(destinations, resilience.DroneBackupExecutablePaths(paths, role)...)
	if resilience.NormalizeDroneRole(role) == resilience.DroneRole1 {
		destinations = append(destinations, resilience.DroneColdSparePath(paths))
	}

	var errs []error
	for _, destinationPath := range destinations {
		if sameWindowsPath(sourcePath, destinationPath) {
			continue
		}
		if err := resilience.CopyExecutable(sourcePath, destinationPath); err != nil {
			errs = append(errs, fmt.Errorf("copy %s to %s: %w", sourcePath, destinationPath, err))
		}
	}

	return errors.Join(errs...)
}
