package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/charliearnerstal/cordyceps/d1/internal/resilience"
)

func TestRefreshBundledDroneTrustManifestWritesAllBundledRoleHashes(t *testing.T) {
	tempDir := t.TempDir()
	paths := resilience.Paths{
		ConfigPath:      filepath.Join(tempDir, "appdata", "D1Agent", "config.json"),
		InstallRoot:     filepath.Join(tempDir, "localappdata", "D1Agent"),
		ProgramDataRoot: filepath.Join(tempDir, "programdata", "CordycepsD1"),
	}

	originalReader := readBundledCompanion
	readBundledCompanion = func(name string) ([]byte, error) {
		return []byte("MZbundle-" + name), nil
	}
	t.Cleanup(func() {
		readBundledCompanion = originalReader
	})

	refreshed, err := refreshBundledDroneTrustManifest(paths)
	if err != nil {
		t.Fatalf("refreshBundledDroneTrustManifest() error = %v", err)
	}
	if !refreshed {
		t.Fatal("refreshBundledDroneTrustManifest() = false, want true")
	}

	wantHashes := make([]string, 0, len(resilience.DroneRoles()))
	for _, role := range resilience.DroneRoles() {
		sum := sha256.Sum256([]byte("MZbundle-" + bundledDroneName(role)))
		wantHashes = append(wantHashes, hex.EncodeToString(sum[:]))
	}
	sort.Strings(wantHashes)

	for _, manifestPath := range resilience.DroneTrustManifestPaths(paths) {
		payload, err := os.ReadFile(manifestPath)
		if err != nil {
			t.Fatalf("ReadFile(%q) error = %v", manifestPath, err)
		}

		var manifest bundledDroneTrustManifest
		if err := json.Unmarshal(payload, &manifest); err != nil {
			t.Fatalf("json.Unmarshal(%q) error = %v", manifestPath, err)
		}

		if got := strings.TrimSpace(manifest.Version); got != strings.TrimSpace(defaultVersion) {
			t.Fatalf("manifest version at %q = %q, want %q", manifestPath, got, strings.TrimSpace(defaultVersion))
		}
		if manifest.UpdatedAt == "" {
			t.Fatalf("manifest updated_at at %q is empty", manifestPath)
		}
		if !reflect.DeepEqual(manifest.TrustedSHA256, wantHashes) {
			t.Fatalf("manifest hashes at %q = %v, want %v", manifestPath, manifest.TrustedSHA256, wantHashes)
		}
	}
}

func TestRefreshBundledDroneTrustManifestSkipsWhenNoBundledDronesExist(t *testing.T) {
	tempDir := t.TempDir()
	paths := resilience.Paths{
		ConfigPath:      filepath.Join(tempDir, "appdata", "D1Agent", "config.json"),
		InstallRoot:     filepath.Join(tempDir, "localappdata", "D1Agent"),
		ProgramDataRoot: filepath.Join(tempDir, "programdata", "CordycepsD1"),
	}

	originalReader := readBundledCompanion
	readBundledCompanion = func(string) ([]byte, error) {
		return nil, os.ErrNotExist
	}
	t.Cleanup(func() {
		readBundledCompanion = originalReader
	})

	refreshed, err := refreshBundledDroneTrustManifest(paths)
	if err != nil {
		t.Fatalf("refreshBundledDroneTrustManifest() error = %v", err)
	}
	if refreshed {
		t.Fatal("refreshBundledDroneTrustManifest() = true, want false")
	}

	for _, manifestPath := range resilience.DroneTrustManifestPaths(paths) {
		if _, err := os.Stat(manifestPath); !os.IsNotExist(err) {
			t.Fatalf("manifest %q exists unexpectedly", manifestPath)
		}
	}
}
