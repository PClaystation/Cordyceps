package drone

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/instance"
	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
)

func TestLoadTrustedHashesBootstrapsFromSelfExecutable(t *testing.T) {
	paths := newTestPaths(t)
	selfExe := filepath.Join(t.TempDir(), "self.exe")
	writeFakeExe(t, selfExe)

	trusted, err := loadTrustedHashes(paths, selfExe, "1.2.3")
	if err != nil {
		t.Fatalf("loadTrustedHashes returned error: %v", err)
	}
	if len(trusted) != 1 {
		t.Fatalf("len(trusted)=%d, want 1", len(trusted))
	}

	if err := persistTrustedHashes(paths, trusted, "1.2.3"); err != nil {
		t.Fatalf("persistTrustedHashes returned error: %v", err)
	}

	for _, manifestPath := range resilience.DroneTrustManifestPaths(paths) {
		if _, err := os.Stat(manifestPath); err != nil {
			t.Fatalf("manifest missing at %s: %v", manifestPath, err)
		}
	}
}

func TestEnsureDroneRoleSeedsImagesAndLaunchesStoppedRole(t *testing.T) {
	paths := newTestPaths(t)
	selfExe := filepath.Join(t.TempDir(), "self.exe")
	writeFakeExe(t, selfExe)

	trusted, err := loadTrustedHashes(paths, selfExe, "1.2.3")
	if err != nil {
		t.Fatalf("loadTrustedHashes returned error: %v", err)
	}

	origLaunch := relaunchDetached
	origAcquire := acquireInstanceLock
	origNow := timeNow
	t.Cleanup(func() {
		relaunchDetached = origLaunch
		acquireInstanceLock = origAcquire
		timeNow = origNow
	})

	timeNow = func() time.Time { return time.Unix(1700000000, 0).UTC() }

	launchedRoles := make([]string, 0, 1)
	relaunchDetached = func(_ string, args []string) error {
		for index := 0; index < len(args)-1; index++ {
			if args[index] == "--role" {
				launchedRoles = append(launchedRoles, args[index+1])
			}
		}
		return nil
	}
	acquireInstanceLock = func(scope string) (*instance.Lock, error) {
		if strings.HasSuffix(scope, "#drone-"+resilience.DroneRole4) {
			return &instance.Lock{}, nil
		}
		return nil, instance.ErrAlreadyRunning
	}

	if err := ensureDroneRole(paths, resilience.DroneRole1, selfExe, trusted, resilience.DroneRole4); err != nil {
		t.Fatalf("ensureDroneRole returned error: %v", err)
	}

	for _, path := range []string{
		resilience.DroneExecutablePath(paths, resilience.DroneRole4),
		resilience.DroneBackupExecutablePath(paths, resilience.DroneRole4),
		resilience.DroneTemplatePath(paths, resilience.DroneRole4),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected seeded artifact at %s: %v", path, err)
		}
	}
	if len(launchedRoles) != 1 || launchedRoles[0] != resilience.DroneRole4 {
		t.Fatalf("launchedRoles=%v", launchedRoles)
	}
}

func TestBestAvailableDroneImagePrefersTrustedCandidates(t *testing.T) {
	paths := newTestPaths(t)
	selfExe := filepath.Join(t.TempDir(), "self.exe")
	writeFakeExe(t, selfExe)
	writeFakeExe(t, resilience.DroneColdSparePath(paths))

	trusted, err := loadTrustedHashes(paths, selfExe, "1.2.3")
	if err != nil {
		t.Fatalf("loadTrustedHashes returned error: %v", err)
	}

	got, err := bestAvailableDroneImage(paths, selfExe, resilience.DroneRole1, resilience.DroneRole5, trusted)
	if err != nil {
		t.Fatalf("bestAvailableDroneImage returned error: %v", err)
	}
	if got != selfExe {
		t.Fatalf("bestAvailableDroneImage=%q, want %q", got, selfExe)
	}
}

func TestWithRestoreClaimSkipsFreshClaim(t *testing.T) {
	paths := newTestPaths(t)
	claimPath := resilience.DroneRestoreClaimPath(paths, resilience.DroneRole2)
	if err := os.MkdirAll(filepath.Dir(claimPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(claimPath, []byte("busy"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	called := false
	if err := withRestoreClaim(paths, resilience.DroneRole2, func() error {
		called = true
		return nil
	}); err != nil {
		t.Fatalf("withRestoreClaim returned error: %v", err)
	}
	if called {
		t.Fatal("restore action should have been skipped while claim was fresh")
	}
}

func TestEnsureColdSpareSeedsDormantCopy(t *testing.T) {
	paths := newTestPaths(t)
	selfExe := filepath.Join(t.TempDir(), "self.exe")
	writeFakeExe(t, selfExe)

	trusted, err := loadTrustedHashes(paths, selfExe, "1.2.3")
	if err != nil {
		t.Fatalf("loadTrustedHashes returned error: %v", err)
	}

	if err := ensureColdSpare(paths, resilience.DroneRole1, selfExe, trusted); err != nil {
		t.Fatalf("ensureColdSpare returned error: %v", err)
	}
	if _, err := os.Stat(resilience.DroneColdSparePath(paths)); err != nil {
		t.Fatalf("cold spare missing: %v", err)
	}
}

func newTestPaths(t *testing.T) resilience.Paths {
	t.Helper()
	root := t.TempDir()
	return resilience.Paths{
		ConfigPath:      filepath.Join(root, "config", "config.json"),
		InstallRoot:     filepath.Join(root, "install"),
		ProgramDataRoot: filepath.Join(root, "programdata"),
	}
}

func writeFakeExe(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", path, err)
	}
	if err := os.WriteFile(path, []byte("MZ-test-binary"), 0o755); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}
