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
	want := []string{
		DroneRole1,
		DroneRole2,
		DroneRole3,
		DroneRole4,
		DroneRole5,
		DroneRole6,
		DroneRole7,
		DroneRole8,
		DroneRole9,
		DroneRole10,
		DroneRole11,
		DroneRole12,
		DroneRole13,
		DroneRole14,
		DroneRole15,
		DroneRole16,
	}
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
	got := DroneRolesUpTo(16)
	want := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"}
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
	if got := DroneExecutablePath(paths, DroneRole4); got != filepath.Join(paths.InstallRoot, "tools", "mesh-4", "d1-drone-4.exe") {
		t.Fatalf("DroneExecutablePath(4)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole4); got != filepath.Join(filepath.Dir(paths.ConfigPath), "cache", "mesh-4-backup", "d1-drone-4.exe") {
		t.Fatalf("DroneBackupExecutablePath(4)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole5); got != filepath.Join(paths.ProgramDataRoot, "backup", "mesh-5-backup", "d1-drone-5.exe") {
		t.Fatalf("DroneBackupExecutablePath(5)=%q", got)
	}
	if got := DroneExecutablePath(paths, DroneRole6); got != filepath.Join(filepath.Dir(paths.ConfigPath), "spool", "mesh-6", "d1-drone-6.exe") {
		t.Fatalf("DroneExecutablePath(6)=%q", got)
	}
	if got := DroneExecutablePath(paths, DroneRole8); got != filepath.Join(paths.InstallRoot, "telemetry", "mesh-8", "d1-drone-8.exe") {
		t.Fatalf("DroneExecutablePath(8)=%q", got)
	}
	if got := DroneExecutablePath(paths, DroneRole10); got != filepath.Join(paths.ProgramDataRoot, "runtime", "mesh-10", "d1-drone-10.exe") {
		t.Fatalf("DroneExecutablePath(10)=%q", got)
	}
	if got := DroneExecutablePath(paths, DroneRole12); got != filepath.Join(filepath.Dir(paths.ConfigPath), "plugins", "mesh-12", "d1-drone-12.exe") {
		t.Fatalf("DroneExecutablePath(12)=%q", got)
	}
	if got := DroneExecutablePath(paths, DroneRole16); got != filepath.Join(paths.ProgramDataRoot, "archive", "mesh-16", "d1-drone-16.exe") {
		t.Fatalf("DroneExecutablePath(16)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole7); got != filepath.Join(filepath.Dir(paths.ConfigPath), "telemetry", "mesh-7-backup", "d1-drone-7.exe") {
		t.Fatalf("DroneBackupExecutablePath(7)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole8); got != filepath.Join(paths.ProgramDataRoot, "staging", "mesh-8-backup", "d1-drone-8.exe") {
		t.Fatalf("DroneBackupExecutablePath(8)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole11); got != filepath.Join(filepath.Dir(paths.ConfigPath), "vault", "mesh-11-backup", "d1-drone-11.exe") {
		t.Fatalf("DroneBackupExecutablePath(11)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole14); got != filepath.Join(filepath.Dir(paths.ConfigPath), "snapshots", "mesh-14-backup", "d1-drone-14.exe") {
		t.Fatalf("DroneBackupExecutablePath(14)=%q", got)
	}
	if got := DroneBackupExecutablePath(paths, DroneRole16); got != filepath.Join(paths.InstallRoot, "coldstore", "mesh-16-backup", "d1-drone-16.exe") {
		t.Fatalf("DroneBackupExecutablePath(16)=%q", got)
	}
	backupPaths := DroneBackupExecutablePaths(paths, DroneRole9)
	if len(backupPaths) != 2 {
		t.Fatalf("len(DroneBackupExecutablePaths(9))=%d, want 2", len(backupPaths))
	}
	if backupPaths[0] != filepath.Join(paths.ProgramDataRoot, "shadow", "mesh-9-backup", "d1-drone-9.exe") {
		t.Fatalf("DroneBackupExecutablePaths(9)[0]=%q", backupPaths[0])
	}
	if backupPaths[1] != filepath.Join(paths.InstallRoot, "vault", "mesh-9-backup", "d1-drone-9.exe") {
		t.Fatalf("DroneBackupExecutablePaths(9)[1]=%q", backupPaths[1])
	}
	role4LegacyPaths := DroneLegacyArtifactPaths(paths, DroneRole4)
	if len(role4LegacyPaths) != 3 {
		t.Fatalf("len(DroneLegacyArtifactPaths(4))=%d, want 3", len(role4LegacyPaths))
	}
	if role4LegacyPaths[0] != filepath.Join(paths.ProgramDataRoot, "broker", "mesh-4", "d1-drone-4.exe") {
		t.Fatalf("DroneLegacyArtifactPaths(4)[0]=%q", role4LegacyPaths[0])
	}
	if role4LegacyPaths[1] != filepath.Join(filepath.Dir(paths.ConfigPath), "backup", "mesh-4-backup", "d1-drone-4.exe") {
		t.Fatalf("DroneLegacyArtifactPaths(4)[1]=%q", role4LegacyPaths[1])
	}
	if role4LegacyPaths[2] != filepath.Join(paths.InstallRoot, "quarantine", "mesh-4-backup", "d1-drone-4.exe") {
		t.Fatalf("DroneLegacyArtifactPaths(4)[2]=%q", role4LegacyPaths[2])
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

func TestDroneRoleKindUsesStablePseudoRandomOverflowAssignment(t *testing.T) {
	gotFirst := DroneRoleKind("17")
	gotSecond := DroneRoleKind("17")
	if gotFirst != gotSecond {
		t.Fatalf("DroneRoleKind(17) changed between calls: %q vs %q", gotFirst, gotSecond)
	}

	bucket := DroneRoleNumber(gotFirst)
	if bucket < 1 || bucket > len(DroneRoles()) {
		t.Fatalf("DroneRoleKind(17)=%q, want canonical role within 1..%d", gotFirst, len(DroneRoles()))
	}

	if gotFirst == NormalizeDroneRole("17") {
		t.Fatalf("DroneRoleKind(17)=%q, want overflow role to map to a canonical kind", gotFirst)
	}
}
