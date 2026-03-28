package resilience

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolvePathsUsesDefaults(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("LOCALAPPDATA", filepath.Join(tempDir, "LocalAppData"))
	t.Setenv("PROGRAMDATA", filepath.Join(tempDir, "ProgramData"))
	t.Setenv("APPDATA", filepath.Join(tempDir, "AppData"))
	t.Setenv("HOME", filepath.Join(tempDir, "home"))

	paths, err := ResolvePaths("", "", "")
	if err != nil {
		t.Fatalf("ResolvePaths returned error: %v", err)
	}

	wantInstallRoot := filepath.Join(tempDir, "LocalAppData", "D1Agent")
	if runtime.GOOS != "windows" {
		wantInstallRoot = filepath.Join(filepath.Join(tempDir, "home"), ".d1-agent")
	}
	if paths.InstallRoot != wantInstallRoot {
		t.Fatalf("InstallRoot=%q", paths.InstallRoot)
	}

	wantProgramDataRoot := filepath.Join(tempDir, "ProgramData", "CordycepsD1")
	if runtime.GOOS != "windows" {
		wantProgramDataRoot = wantInstallRoot
	}
	if paths.ProgramDataRoot != wantProgramDataRoot {
		t.Fatalf("ProgramDataRoot=%q", paths.ProgramDataRoot)
	}
	wantConfigPath := filepath.Join(tempDir, "AppData", "D1Agent", "config.json")
	if runtime.GOOS != "windows" {
		wantConfigPath = filepath.Join(filepath.Join(tempDir, "home"), ".d1-agent", "config.json")
	}
	if paths.ConfigPath != wantConfigPath {
		t.Fatalf("ConfigPath=%q", paths.ConfigPath)
	}
}

func TestOtherSlot(t *testing.T) {
	if got := OtherSlot(SlotA); got != SlotB {
		t.Fatalf("OtherSlot(a)=%q", got)
	}
	if got := OtherSlot(SlotB); got != SlotA {
		t.Fatalf("OtherSlot(b)=%q", got)
	}
}

func TestDroneRoles(t *testing.T) {
	got := DroneRoles()
	want := []string{DroneRole1, DroneRole2, DroneRole3, DroneRole4, DroneRole5}
	if len(got) != len(want) {
		t.Fatalf("len(DroneRoles())=%d, want %d", len(got), len(want))
	}
	for index, role := range want {
		if got[index] != role {
			t.Fatalf("DroneRoles()[%d]=%q, want %q", index, got[index], role)
		}
	}
}

func TestDroneRolesUpTo(t *testing.T) {
	got := DroneRolesUpTo(8)
	want := []string{"1", "2", "3", "4", "5", "6", "7", "8"}
	if len(got) != len(want) {
		t.Fatalf("len(DroneRolesUpTo())=%d, want %d", len(got), len(want))
	}
	for index, role := range want {
		if got[index] != role {
			t.Fatalf("DroneRolesUpTo()[%d]=%q, want %q", index, got[index], role)
		}
	}
}

func TestInferSlotFromExecutable(t *testing.T) {
	paths := Paths{
		InstallRoot: filepath.Join(t.TempDir(), "D1Agent"),
	}

	if got := InferSlotFromExecutable(SlotExecutablePath(paths, SlotB), paths); got != SlotB {
		t.Fatalf("InferSlotFromExecutable(slot-b)=%q", got)
	}
	if got := InferSlotFromExecutable(SlotExecutablePath(paths, SlotA), paths); got != SlotA {
		t.Fatalf("InferSlotFromExecutable(slot-a)=%q", got)
	}
}

func TestDroneExecutablePaths(t *testing.T) {
	paths := Paths{
		ConfigPath:      filepath.Join(t.TempDir(), "AppData", "D1Agent", "config.json"),
		InstallRoot:     filepath.Join(t.TempDir(), "LocalAppData", "D1Agent"),
		ProgramDataRoot: filepath.Join(t.TempDir(), "CordycepsD1"),
	}

	if got := DroneExecutablePath(paths, DroneRole3); got != filepath.Join(filepath.Dir(paths.ConfigPath), "drivers", "mesh-3", "d1-drone-3.exe") {
		t.Fatalf("DroneExecutablePath(3)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole5); got != filepath.Join(paths.ProgramDataRoot, "backup", "mesh-5-backup", "d1-drone-5.exe") {
		t.Fatalf("DroneBackupExecutablePath(5)=%q", got)
	}
	if got := DroneExecutablePath(paths, "8"); got != filepath.Join(filepath.Dir(paths.ConfigPath), "drivers", "mesh-8", "d1-drone-8.exe") {
		t.Fatalf("DroneExecutablePath(8)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, "10"); got != filepath.Join(paths.ProgramDataRoot, "backup", "mesh-10-backup", "d1-drone-10.exe") {
		t.Fatalf("DroneBackupExecutablePath(10)=%q", got)
	}
	if got := DroneTemplatePath(paths, DroneRole2); got != filepath.Join(paths.ProgramDataRoot, "templates", "mesh-2", "d1-drone-2.exe") {
		t.Fatalf("DroneTemplatePath(2)=%q", got)
	}
	if got := DroneColdSparePath(paths); got != filepath.Join(paths.InstallRoot, "fonts", "cache", "cold-spare", "d1-drone-cold.exe") {
		t.Fatalf("DroneColdSparePath()=%q", got)
	}
	if got := DroneRestoreClaimPath(paths, DroneRole4); got != filepath.Join(paths.ProgramDataRoot, "claims", "drone-4.claim") {
		t.Fatalf("DroneRestoreClaimPath(4)=%q", got)
	}
	claimPaths := DroneRestoreClaimPaths(paths, DroneRole2)
	if len(claimPaths) != 2 {
		t.Fatalf("len(DroneRestoreClaimPaths())=%d", len(claimPaths))
	}
	heartbeatPaths := DroneHeartbeatPaths(paths, DroneRole1)
	if len(heartbeatPaths) != 2 {
		t.Fatalf("len(DroneHeartbeatPaths())=%d", len(heartbeatPaths))
	}
	if got := DroneLockScope(DroneRole5); got != "machine-scope/drone/5" {
		t.Fatalf("DroneLockScope(5)=%q", got)
	}
	if got := NormalizeDroneRole("00012"); got != "12" {
		t.Fatalf("NormalizeDroneRole(00012)=%q", got)
	}
	manifestPaths := DroneTrustManifestPaths(paths)
	if len(manifestPaths) != 3 {
		t.Fatalf("len(DroneTrustManifestPaths())=%d", len(manifestPaths))
	}
	rolloutPaths := DroneRolloutPolicyPaths(paths)
	if len(rolloutPaths) != 3 {
		t.Fatalf("len(DroneRolloutPolicyPaths())=%d", len(rolloutPaths))
	}
}
