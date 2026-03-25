package main

import (
	"slices"
	"testing"
)

func TestSupportedScopeLabel(t *testing.T) {
	want := "all,agent,t1,s1,d1,ds1,se1,e1,a1"
	if got := supportedScopeLabel(); got != want {
		t.Fatalf("supportedScopeLabel() = %q, want %q", got, want)
	}
}

func TestResolveScopeAllReturnsKnownFamiliesInOrder(t *testing.T) {
	got, err := resolveScope("all")
	if err != nil {
		t.Fatalf("resolveScope(all) returned error: %v", err)
	}
	if !slices.Equal(got, strainOrder) {
		t.Fatalf("resolveScope(all) = %v, want %v", got, strainOrder)
	}
}

func TestD1DefinitionIncludesGuardianArtifacts(t *testing.T) {
	def := strains["d1"]

	for _, taskName := range []string{
		"DevHelperBackgroundLogon",
		"DevHelperBackgroundBoot",
		"DevHelperBackgroundWatchdog",
		"D1GuardianLogon",
		"D1GuardianBoot",
		"D1GuardianWatchdog",
	} {
		if !slices.Contains(def.TaskNames, taskName) {
			t.Fatalf("d1 task list is missing %q", taskName)
		}
	}

	for _, serviceName := range []string{"CordycepsD1", "CordycepsD1Guardian"} {
		if !slices.Contains(def.ServiceNames, serviceName) {
			t.Fatalf("d1 service list is missing %q", serviceName)
		}
	}

	for _, runValue := range []string{"D1Agent", "D1Guardian"} {
		if !slices.Contains(def.RunValueNames, runValue) {
			t.Fatalf("d1 run value list is missing %q", runValue)
		}
	}

	if !slices.Contains(def.ProcessNames, "d1-guardian.exe") {
		t.Fatal(`d1 process list is missing "d1-guardian.exe"`)
	}
	if !slices.Contains(def.ProgramDataDirs, "CordycepsD1") {
		t.Fatal(`d1 program data list is missing "CordycepsD1"`)
	}
}

func TestDS1DefinitionIncludesOptionalWindowsService(t *testing.T) {
	def := strains["ds1"]
	if !slices.Contains(def.ServiceNames, "CordycepsDS1") {
		t.Fatal(`ds1 service list is missing "CordycepsDS1"`)
	}
}
