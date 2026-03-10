package startup

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func EnsureStartupRegistration(executablePath string) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	if executablePath == "" {
		return fmt.Errorf("empty executable path")
	}

	taskCommand := hiddenLaunchCommand(executablePath)
	cmd := exec.Command(
		"schtasks",
		"/Create",
		"/TN",
		"JarvisAgent",
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
	runValue := hiddenLaunchCommand(executablePath)
	cmd := exec.Command(
		"reg",
		"add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		"JarvisAgent",
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

func hiddenLaunchCommand(executablePath string) string {
	escapedPath := strings.ReplaceAll(executablePath, "'", "''")
	escapedDir := strings.ReplaceAll(filepath.Dir(executablePath), "'", "''")
	return fmt.Sprintf(
		`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -WorkingDirectory '%s' -FilePath '%s' -ArgumentList '--run-agent'"`,
		escapedDir,
		escapedPath,
	)
}
