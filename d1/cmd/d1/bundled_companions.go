package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charliearnerstal/cordyceps/d1/internal/resilience"
)

const (
	bundledGuardianName  = "d1-guardian.bin"
	bundledHeartbeatName = "d1-heartbeat.bin"
)

var readBundledCompanion = readBundledCompanionFile

func bundledDroneName(role string) string {
	return "d1-drone-" + resilience.NormalizeDroneRole(role) + ".bin"
}

func bundledCompanionData(name string) ([]byte, bool) {
	data, err := readBundledCompanion(strings.TrimSpace(name))
	if err != nil {
		return nil, false
	}
	if !looksLikeWindowsExecutable(data) {
		return nil, false
	}
	return data, true
}

func looksLikeWindowsExecutable(data []byte) bool {
	return len(data) >= 2 && data[0] == 'M' && data[1] == 'Z'
}

func stageBundledExecutableIfPresent(fileName string, targetPath string) (bool, error) {
	data, ok := bundledCompanionData(fileName)
	if !ok {
		return false, nil
	}

	if err := writeExecutablePayload(targetPath, data); err != nil {
		return true, fmt.Errorf("write %s to %s: %w", fileName, targetPath, err)
	}

	return true, nil
}

func stageBundledDroneArtifactsIfPresent(paths resilience.Paths, role string) (bool, error) {
	data, ok := bundledCompanionData(bundledDroneName(role))
	if !ok {
		return false, nil
	}

	destinations := []string{
		resilience.DroneExecutablePath(paths, role),
		resilience.DroneTemplatePath(paths, role),
	}
	destinations = append(destinations, resilience.DroneBackupExecutablePaths(paths, role)...)
	if resilience.NormalizeDroneRole(role) == resilience.DroneRole1 {
		destinations = append(destinations, resilience.DroneColdSparePath(paths))
	}

	seen := make(map[string]struct{}, len(destinations))
	var errs []error
	for _, destinationPath := range destinations {
		key := strings.ToLower(filepath.Clean(destinationPath))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		if err := writeExecutablePayload(destinationPath, data); err != nil {
			errs = append(errs, fmt.Errorf("write %s to %s: %w", bundledDroneName(role), destinationPath, err))
		}
	}

	return true, errors.Join(errs...)
}

func writeExecutablePayload(destinationPath string, payload []byte) error {
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o700); err != nil {
		return err
	}

	tempPath := destinationPath + ".tmp"
	if err := os.WriteFile(tempPath, payload, 0o700); err != nil {
		return err
	}

	_ = os.Remove(destinationPath)
	if err := os.Rename(tempPath, destinationPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	return nil
}
