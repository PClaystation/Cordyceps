package commands

import "testing"

func TestOpenAppTargetsIncludeShellAliases(t *testing.T) {
	testCases := map[string]string{
		"terminal":   "cmd",
		"powershell": "powershell",
		"cmd":        "cmd",
	}

	for alias, want := range testCases {
		if got := openAppTargets[alias]; got != want {
			t.Fatalf("openAppTargets[%q]=%q, want %q", alias, got, want)
		}
	}
}
