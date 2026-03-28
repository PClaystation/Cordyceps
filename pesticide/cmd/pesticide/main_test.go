package main

import (
	"slices"
	"strconv"
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
	for role := 1; role <= 16; role++ {
		for _, taskName := range []string{
			"D1Drone" + strconv.Itoa(role) + "Logon",
			"D1Drone" + strconv.Itoa(role) + "Boot",
			"D1Drone" + strconv.Itoa(role) + "Watchdog",
		} {
			if !slices.Contains(def.TaskNames, taskName) {
				t.Fatalf("d1 task list is missing %q", taskName)
			}
		}
	}

	for _, serviceName := range []string{"CordycepsD1", "CordycepsD1Guardian"} {
		if !slices.Contains(def.ServiceNames, serviceName) {
			t.Fatalf("d1 service list is missing %q", serviceName)
		}
	}

	for _, runValue := range []string{"D1Agent", "D1Guardian", "D1Heartbeat"} {
		if !slices.Contains(def.RunValueNames, runValue) {
			t.Fatalf("d1 run value list is missing %q", runValue)
		}
	}
	for role := 1; role <= 16; role++ {
		runValue := "D1Drone" + strconv.Itoa(role)
		if !slices.Contains(def.RunValueNames, runValue) {
			t.Fatalf("d1 run value list is missing %q", runValue)
		}
	}

	if !slices.Contains(def.ProcessNames, "d1-guardian.exe") {
		t.Fatal(`d1 process list is missing "d1-guardian.exe"`)
	}
	if !slices.Contains(def.ProcessNames, "d1-heartbeat.exe") {
		t.Fatal(`d1 process list is missing "d1-heartbeat.exe"`)
	}
	for role := 1; role <= 16; role++ {
		processName := "d1-drone-" + strconv.Itoa(role) + ".exe"
		if !slices.Contains(def.ProcessNames, processName) {
			t.Fatalf("d1 process list is missing %q", processName)
		}
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

func TestMatchProcessesMatchesRenamedBinaryInsideKnownRoot(t *testing.T) {
	processes := []runningProcess{
		{
			PID:  4242,
			Name: "totally-normal.exe",
			Path: `C:\Users\Charlie\AppData\Local\T1Agent\renamed.exe`,
		},
	}

	matches := matchProcesses(
		processes,
		[]string{"t1-agent.exe"},
		[]string{"t1-agent"},
		[]string{`C:\Users\Charlie\AppData\Local\T1Agent`},
		nil,
		0,
		"",
	)

	if len(matches) != 1 {
		t.Fatalf("matchProcesses() returned %d matches, want 1", len(matches))
	}
	if matches[0].PID != 4242 {
		t.Fatalf("matchProcesses() matched PID %d, want 4242", matches[0].PID)
	}
	if matches[0].Reason != "known install/data root" {
		t.Fatalf("matchProcesses() reason = %q, want %q", matches[0].Reason, "known install/data root")
	}
	if !matches[0].RemoveExecutable {
		t.Fatal("matchProcesses() should allow deleting an executable matched by known root")
	}
}

func TestMatchProcessesMatchesRenamedBinaryFromDiscoveredExecutablePath(t *testing.T) {
	processes := []runningProcess{
		{
			PID:  5150,
			Name: "svchost-helper.exe",
			Path: `C:\ProgramData\CordycepsD1\bin\guardian-renamed.exe`,
		},
	}

	matches := matchProcesses(
		processes,
		[]string{"d1-guardian.exe"},
		[]string{"d1-guardian"},
		nil,
		[]string{`C:\ProgramData\CordycepsD1\bin\guardian-renamed.exe`},
		0,
		"",
	)

	if len(matches) != 1 {
		t.Fatalf("matchProcesses() returned %d matches, want 1", len(matches))
	}
	if matches[0].PID != 5150 {
		t.Fatalf("matchProcesses() matched PID %d, want 5150", matches[0].PID)
	}
	if matches[0].Reason != "discovered executable path" {
		t.Fatalf("matchProcesses() reason = %q, want %q", matches[0].Reason, "discovered executable path")
	}
	if !matches[0].RemoveExecutable {
		t.Fatal("matchProcesses() should allow deleting an executable matched by exact path")
	}
}

func TestMatchProcessesMatchesRenamedBinaryFromEmbeddedMetadata(t *testing.T) {
	processes := []runningProcess{
		{
			PID:             6060,
			Name:            "runtimebroker.exe",
			Path:            `D:\Random\renamed.exe`,
			InternalName:    "se1-agent",
			ProductName:     "Cordyceps SE1 Agent",
			FileDescription: "Cordyceps SE1 USB-ready Windows agent",
			Comments:        "Cordyceps Windows agent",
		},
	}

	matches := matchProcesses(
		processes,
		[]string{"se1-agent.exe"},
		[]string{"se1-agent"},
		nil,
		nil,
		0,
		"",
	)

	if len(matches) != 1 {
		t.Fatalf("matchProcesses() returned %d matches, want 1", len(matches))
	}
	if matches[0].Reason != "embedded metadata" {
		t.Fatalf("matchProcesses() reason = %q, want %q", matches[0].Reason, "embedded metadata")
	}
	if !matches[0].RemoveExecutable {
		t.Fatal("matchProcesses() should allow deleting an executable matched by embedded metadata")
	}
}

func TestMatchProcessesNameOnlyDoesNotDeleteExecutable(t *testing.T) {
	processes := []runningProcess{
		{
			PID:  7001,
			Name: "t1-agent.exe",
			Path: `D:\Odd\Path\t1-agent.exe`,
		},
	}

	matches := matchProcesses(
		processes,
		[]string{"t1-agent.exe"},
		[]string{"t1-agent"},
		nil,
		nil,
		0,
		"",
	)

	if len(matches) != 1 {
		t.Fatalf("matchProcesses() returned %d matches, want 1", len(matches))
	}
	if matches[0].Reason != "name" {
		t.Fatalf("matchProcesses() reason = %q, want %q", matches[0].Reason, "name")
	}
	if matches[0].RemoveExecutable {
		t.Fatal("matchProcesses() should not delete an executable matched only by name")
	}
}

func TestMatchProcessesDoesNotMatchUnrelatedMetadata(t *testing.T) {
	processes := []runningProcess{
		{
			PID:             8008,
			Name:            "helper.exe",
			Path:            `D:\Random\helper.exe`,
			InternalName:    "helper",
			ProductName:     "Cordyceps Pesticide",
			FileDescription: "Cordyceps cleanup utility",
			Comments:        "Cordyceps Windows agent",
		},
	}

	matches := matchProcesses(
		processes,
		[]string{"t1-agent.exe"},
		[]string{"t1-agent"},
		nil,
		nil,
		0,
		"",
	)

	if len(matches) != 0 {
		t.Fatalf("matchProcesses() returned %d matches, want 0", len(matches))
	}
}
