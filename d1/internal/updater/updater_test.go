package updater

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charliearnerstal/cordyceps/d1/internal/resilience"
)

func TestDeviceConfigClass(t *testing.T) {

	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "se class", input: "se1", want: "se"},
		{name: "ds class", input: "ds1", want: "ds"},
		{name: "d class", input: "d1", want: "d"},
		{name: "t class", input: "t1", want: "t"},
		{name: "e class", input: "e1", want: "e"},
		{name: "a class", input: "a1", want: "a"},
		{name: "core fallback", input: "m1", want: "core"},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := deviceConfigClass(tc.input)
			if got != tc.want {
				t.Fatalf("deviceConfigClass(%q)=%q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestConfigPathForDeviceIDWithAppData(t *testing.T) {

	appData := filepath.Join(t.TempDir(), "AppData")
	t.Setenv("APPDATA", appData)

	testCases := []struct {
		deviceID string
		wantDir  string
	}{
		{deviceID: "t1", wantDir: "T1Agent"},
		{deviceID: "se1", wantDir: "SE1Agent"},
		{deviceID: "ds1", wantDir: "DS1Agent"},
		{deviceID: "s1", wantDir: "S1Agent"},
		{deviceID: "d1", wantDir: "D1Agent"},
		{deviceID: "e1", wantDir: "E1Agent"},
		{deviceID: "a1", wantDir: "A1Agent"},
		{deviceID: "m1", wantDir: "CordycepsAgent"},
	}

	for _, tc := range testCases {
		path, err := configPathForDeviceID(tc.deviceID)
		if err != nil {
			t.Fatalf("configPathForDeviceID(%q) returned error: %v", tc.deviceID, err)
		}

		want := filepath.Join(appData, tc.wantDir, "config.json")
		if path != want {
			t.Fatalf("configPathForDeviceID(%q)=%q, want %q", tc.deviceID, path, want)
		}
	}
}

func TestInstalledExePathForDeviceIDWithLocalAppData(t *testing.T) {
	localAppData := filepath.Join(t.TempDir(), "LocalAppData")
	t.Setenv("LOCALAPPDATA", localAppData)

	testCases := []struct {
		deviceID string
		wantPath string
	}{
		{deviceID: "t1", wantPath: filepath.Join(localAppData, "T1Agent", "t1-agent.exe")},
		{deviceID: "se1", wantPath: filepath.Join(localAppData, "SE1Agent", "se1-agent.exe")},
		{deviceID: "ds1", wantPath: filepath.Join(localAppData, "DS1Agent", "ds1-agent.exe")},
		{deviceID: "s1", wantPath: filepath.Join(localAppData, "S1Agent", "s1-agent.exe")},
		{deviceID: "d1", wantPath: filepath.Join(localAppData, "D1Agent", "d1-agent.exe")},
		{deviceID: "e1", wantPath: filepath.Join(localAppData, "E1Agent", "e1-agent.exe")},
		{deviceID: "a1", wantPath: filepath.Join(localAppData, "A1Agent", "a1-agent.exe")},
		{deviceID: "m1", wantPath: filepath.Join(localAppData, "CordycepsAgent", "agent.exe")},
	}

	for _, tc := range testCases {
		path, err := installedExePathForDeviceID(tc.deviceID)
		if err != nil {
			t.Fatalf("installedExePathForDeviceID(%q) returned error: %v", tc.deviceID, err)
		}

		if path != tc.wantPath {
			t.Fatalf("installedExePathForDeviceID(%q)=%q, want %q", tc.deviceID, path, tc.wantPath)
		}
	}
}

func TestConfigPathForDeviceIDWithoutAppData(t *testing.T) {

	home := filepath.Join(t.TempDir(), "home")
	t.Setenv("APPDATA", "")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	testCases := []struct {
		deviceID string
		wantDir  string
	}{
		{deviceID: "t1", wantDir: ".t1-agent"},
		{deviceID: "se1", wantDir: ".se1-agent"},
		{deviceID: "ds1", wantDir: ".ds1-agent"},
		{deviceID: "s1", wantDir: ".s1-agent"},
		{deviceID: "d1", wantDir: ".d1-agent"},
		{deviceID: "e1", wantDir: ".e1-agent"},
		{deviceID: "a1", wantDir: ".a1-agent"},
		{deviceID: "m1", wantDir: ".cordyceps-agent"},
	}

	for _, tc := range testCases {
		path, err := configPathForDeviceID(tc.deviceID)
		if err != nil {
			t.Fatalf("configPathForDeviceID(%q) returned error: %v", tc.deviceID, err)
		}

		want := filepath.Join(home, tc.wantDir, "config.json")
		if path != want {
			t.Fatalf("configPathForDeviceID(%q)=%q, want %q", tc.deviceID, path, want)
		}
	}
}

func TestParseRequestValidPayload(t *testing.T) {

	args := map[string]any{
		"version":               " 1.2.3 ",
		"url":                   "https://example.com/agent.exe",
		"sha256":                strings.Repeat("A", 64),
		"size_bytes":            float64(42),
		"next_device_id":        " se1 ",
		"use_privileged_helper": "true",
	}

	request, err := parseRequest(args)
	if err != nil {
		t.Fatalf("parseRequest returned error: %v", err)
	}

	if request.Version != "1.2.3" {
		t.Fatalf("Version=%q, want %q", request.Version, "1.2.3")
	}
	if request.URL != "https://example.com/agent.exe" {
		t.Fatalf("URL=%q, want %q", request.URL, "https://example.com/agent.exe")
	}
	if request.SHA256 != strings.Repeat("a", 64) {
		t.Fatalf("SHA256=%q, want lowercase sha", request.SHA256)
	}
	if request.SizeBytes != 42 {
		t.Fatalf("SizeBytes=%d, want 42", request.SizeBytes)
	}
	if request.NextDeviceID != "se1" {
		t.Fatalf("NextDeviceID=%q, want %q", request.NextDeviceID, "se1")
	}
	if !request.UsePrivilegedHelper {
		t.Fatal("UsePrivilegedHelper=false, want true")
	}
}

func TestParseRequestRejectsCredentialedURL(t *testing.T) {

	_, err := parseRequest(map[string]any{
		"version": "1.2.3",
		"url":     "https://user:pass@example.com/agent.exe",
		"sha256":  strings.Repeat("a", 64),
	})
	if err == nil || !strings.Contains(err.Error(), "url must not include credentials") {
		t.Fatalf("expected credential URL error, got %v", err)
	}
}

func TestParseRequestRejectsMissingHost(t *testing.T) {

	_, err := parseRequest(map[string]any{
		"version": "1.2.3",
		"url":     "https:///agent.exe",
		"sha256":  strings.Repeat("a", 64),
	})
	if err == nil || !strings.Contains(err.Error(), "url must include a host") {
		t.Fatalf("expected missing host error, got %v", err)
	}
}

func TestShouldInstallSiblingAgent(t *testing.T) {
	testCases := []struct {
		deviceID string
		want     bool
	}{
		{deviceID: "s1", want: true},
		{deviceID: "se1", want: true},
		{deviceID: "ds1", want: true},
		{deviceID: "t1", want: true},
		{deviceID: "e1", want: true},
		{deviceID: "a1", want: true},
		{deviceID: "d1", want: false},
		{deviceID: "m1", want: false},
		{deviceID: "", want: false},
	}

	for _, tc := range testCases {
		if got := shouldInstallSiblingAgent(tc.deviceID); got != tc.want {
			t.Fatalf("shouldInstallSiblingAgent(%q)=%v, want %v", tc.deviceID, got, tc.want)
		}
	}
}

func TestConfigPathForSiblingDeviceIDPrefersCurrentManagedRoot(t *testing.T) {
	systemAppData := filepath.Join(t.TempDir(), "system", "AppData", "Roaming")
	t.Setenv("APPDATA", systemAppData)

	userConfigPath := filepath.Join(t.TempDir(), "user", "AppData", "Roaming", "D1Agent", "config.json")
	got, err := configPathForSiblingDeviceID(userConfigPath, "s1")
	if err != nil {
		t.Fatalf("configPathForSiblingDeviceID returned error: %v", err)
	}

	want := filepath.Join(filepath.Dir(filepath.Dir(userConfigPath)), "S1Agent", "config.json")
	if got != want {
		t.Fatalf("configPathForSiblingDeviceID()=%q, want %q", got, want)
	}
}

func TestInstalledExePathForSiblingDeviceIDPrefersManagedInstallRoot(t *testing.T) {
	systemLocalAppData := filepath.Join(t.TempDir(), "system", "AppData", "Local")
	t.Setenv("LOCALAPPDATA", systemLocalAppData)

	paths := resilience.Paths{
		InstallRoot: filepath.Join(t.TempDir(), "user", "AppData", "Local", "D1Agent"),
	}

	got, err := installedExePathForSiblingDeviceID(paths, "ds1")
	if err != nil {
		t.Fatalf("installedExePathForSiblingDeviceID returned error: %v", err)
	}

	want := filepath.Join(filepath.Dir(paths.InstallRoot), "DS1Agent", "ds1-agent.exe")
	if got != want {
		t.Fatalf("installedExePathForSiblingDeviceID()=%q, want %q", got, want)
	}
}

func TestWriteSiblingInstallScriptLaunchesRunAgent(t *testing.T) {
	scriptPath, err := writeSiblingInstallScript(
		filepath.Join(t.TempDir(), "S1Agent", "s1-agent.exe"),
		filepath.Join(t.TempDir(), "staged", "s1-agent.exe"),
		filepath.Join(t.TempDir(), "S1Agent", "config.json"),
		"1.2.3",
	)
	if err != nil {
		t.Fatalf("writeSiblingInstallScript returned error: %v", err)
	}
	defer func() { _ = os.Remove(scriptPath) }()

	payload, err := os.ReadFile(scriptPath)
	if err != nil {
		t.Fatalf("read script: %v", err)
	}

	if !strings.Contains(string(payload), "--run-agent") {
		t.Fatalf("sibling install script did not launch with --run-agent:\n%s", string(payload))
	}
}
