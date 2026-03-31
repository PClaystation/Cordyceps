package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
)

type bundledDroneTrustManifest struct {
	Version       string   `json:"version,omitempty"`
	UpdatedAt     string   `json:"updated_at"`
	TrustedSHA256 []string `json:"trusted_sha256"`
}

func refreshBundledDroneTrustManifest(paths resilience.Paths) (bool, error) {
	trusted := make([]string, 0, len(resilience.DroneRoles()))
	seen := make(map[string]struct{}, len(resilience.DroneRoles()))

	for _, role := range resilience.DroneRoles() {
		data, ok := bundledCompanionData(bundledDroneName(role))
		if !ok {
			continue
		}

		sum := sha256.Sum256(data)
		hashValue := hex.EncodeToString(sum[:])
		if _, exists := seen[hashValue]; exists {
			continue
		}

		seen[hashValue] = struct{}{}
		trusted = append(trusted, hashValue)
	}

	if len(trusted) == 0 {
		return false, nil
	}

	sort.Strings(trusted)
	manifest := bundledDroneTrustManifest{
		Version:       strings.TrimSpace(defaultVersion),
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
		TrustedSHA256: trusted,
	}

	var errs []error
	for _, manifestPath := range resilience.DroneTrustManifestPaths(paths) {
		if err := writeManifestJSON(manifestPath, manifest); err != nil {
			errs = append(errs, fmt.Errorf("write %s: %w", manifestPath, err))
		}
	}

	return true, errors.Join(errs...)
}

func writeManifestJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}

	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, payload, 0o600); err != nil {
		return err
	}

	_ = os.Remove(path)
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	return nil
}
