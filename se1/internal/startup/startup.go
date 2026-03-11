package startup

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const currentStartupName = "SE1Agent"

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
		currentStartupName,
		"/SC",
		"ONLOGON",
		"/RL",
		"LIMITED",
		"/TR",
		taskCommand,
		"/F",
	)

	if _, err := cmd.CombinedOutput(); err == nil {
		cleanupOtherStartupRegistrations(false)
		return nil
	}

	// Fallback that works as standard user when Task Scheduler creation is blocked.
	if err := ensureRunKey(executablePath); err != nil {
		return err
	}

	cleanupOtherStartupRegistrations(true)
	return nil
}

func ensureRunKey(executablePath string) error {
	runValue := hiddenLaunchCommand(executablePath)
	cmd := exec.Command(
		"reg",
		"add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		currentStartupName,
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

func cleanupOtherStartupRegistrations(keepCurrentRunKey bool) {
	for _, name := range []string{"S1Agent", "T1Agent", "E1Agent", "A1Agent", "CordycepsAgent", "JarvisAgent"} {
		deleteScheduledTask(name)
		deleteRunKeyValue(name)
	}

	if !keepCurrentRunKey {
		deleteRunKeyValue(currentStartupName)
	}
}

func deleteScheduledTask(name string) {
	cmd := exec.Command("schtasks", "/Delete", "/TN", name, "/F")
	_, _ = cmd.CombinedOutput()
}

func deleteRunKeyValue(name string) {
	cmd := exec.Command(
		"reg",
		"delete",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		name,
		"/f",
	)
	_, _ = cmd.CombinedOutput()
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
