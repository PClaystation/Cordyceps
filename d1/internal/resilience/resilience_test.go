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
