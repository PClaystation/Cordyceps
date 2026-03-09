package startup

import (
	"fmt"
	"os/exec"
	"runtime"
)

func EnsureStartupRegistration(executablePath string) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	if executablePath == "" {
		return fmt.Errorf("empty executable path")
	}

	taskCommand := fmt.Sprintf("\"%s\"", executablePath)
	cmd := exec.Command(
		"schtasks",
		"/Create",
		"/TN",
		"T1Agent",
		"/SC",
		"ONLOGON",
		"/RL",
		"LIMITED",
		"/TR",
		taskCommand,
		"/F",
	)

	if _, err := cmd.CombinedOutput(); err == nil {
		return nil
	}

	// Fallback that works as standard user when Task Scheduler creation is blocked.
	return ensureRunKey(executablePath)
}

func ensureRunKey(executablePath string) error {
	runValue := fmt.Sprintf("\"%s\"", executablePath)
	cmd := exec.Command(
		"reg",
		"add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		"T1Agent",
		"/t",
		"REG_SZ",
		"/d",
		runValue,
		"/f",
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("register startup run key: %w: %s", err, string(output))
	}

	return nil
}
