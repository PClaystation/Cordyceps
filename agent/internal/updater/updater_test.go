package updater

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestDeviceConfigClass(t *testing.T) {

	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "se class", input: "se1", want: "se"},
		{name: "s class", input: "s1", want: "s"},
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
		{deviceID: "s1", wantDir: "S1Agent"},
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

func TestConfigPathForDeviceIDWithoutAppData(t *testing.T) {

	home := filepath.Join(t.TempDir(), "home")
	t.Setenv("APPDATA", "")
	t.Setenv("HOME", home)

	testCases := []struct {
		deviceID string
		wantDir  string
	}{
		{deviceID: "t1", wantDir: ".t1-agent"},
		{deviceID: "se1", wantDir: ".se1-agent"},
		{deviceID: "s1", wantDir: ".s1-agent"},
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
