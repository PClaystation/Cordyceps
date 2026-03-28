package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
)

func TestStageManagedCompanionsIfPresentSeedsManagedTargets(t *testing.T) {
	tempDir := t.TempDir()
	sourceDir := filepath.Join(tempDir, "source")
	distDir := filepath.Join(sourceDir, "dist")
	agentPath := filepath.Join(sourceDir, "d1.exe")
	paths := resilience.Paths{
		ConfigPath:      filepath.Join(tempDir, "appdata", "D1Agent", "config.json"),
		InstallRoot:     filepath.Join(tempDir, "localappdata", "D1Agent"),
		ProgramDataRoot: filepath.Join(tempDir, "programdata", "CordycepsD1"),
	}

	writeTestExecutable(t, agentPath, "agent")
	writeTestExecutable(t, filepath.Join(distDir, "d1-guardian.exe"), "guardian")
	writeTestExecutable(t, filepath.Join(distDir, "d1-heartbeat.exe"), "heartbeat")
	for _, role := range resilience.DroneRoles() {
		writeTestExecutable(t, filepath.Join(distDir, "d1-drone-"+role+".exe"), "drone-"+role)
	}

	if err := stageManagedCompanionsIfPresent(agentPath, paths); err != nil {
		t.Fatalf("stageManagedCompanionsIfPresent() error = %v", err)
	}

	assertTestExecutablePayload(t, resilience.GuardianExecutablePath(paths), "guardian")
	assertTestExecutablePayload(t, resilience.HeartbeatExecutablePath(paths), "heartbeat")
	assertTestExecutablePayload(t, resilience.DroneColdSparePath(paths), "drone-1")

	for _, role := range resilience.DroneRoles() {
		want := "drone-" + role
		assertTestExecutablePayload(t, resilience.DroneExecutablePath(paths, role), want)
		assertTestExecutablePayload(t, resilience.DroneBackupExecutablePath(paths, role), want)
		assertTestExecutablePayload(t, resilience.DroneTemplatePath(paths, role), want)
	}
}

func TestDiscoverRestoreDroneSourceFallsBackToManagedArtifacts(t *testing.T) {
	tempDir := t.TempDir()
	paths := resilience.Paths{
		ConfigPath:      filepath.Join(tempDir, "appdata", "D1Agent", "config.json"),
		InstallRoot:     filepath.Join(tempDir, "localappdata", "D1Agent"),
		ProgramDataRoot: filepath.Join(tempDir, "programdata", "CordycepsD1"),
	}
	backupPath := resilience.DroneBackupExecutablePath(paths, resilience.DroneRole3)
	agentPath := filepath.Join(paths.InstallRoot, "slots", "slot-a", "d1-agent.exe")

	writeTestExecutable(t, backupPath, "backup-drone-3")

	got, err := discoverRestoreDroneSource(agentPath, paths, resilience.DroneRole3)
	if err != nil {
		t.Fatalf("discoverRestoreDroneSource() error = %v", err)
	}
	if got != backupPath {
		t.Fatalf("discoverRestoreDroneSource() = %q, want %q", got, backupPath)
	}
}

func writeTestExecutable(t *testing.T, path string, payload string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte("MZ"+payload), 0o700); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}
}

func assertTestExecutablePayload(t *testing.T, path string, want string) {
	t.Helper()

	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", path, err)
	}
	got := string(payload)
	if got != "MZ"+want {
		t.Fatalf("payload at %q = %q, want %q", path, got, "MZ"+want)
	}
}
