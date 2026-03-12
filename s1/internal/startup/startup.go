package startup

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	currentStartupName         = "S1Agent"
	currentBootStartupName     = "S1AgentBoot"
	currentWatchdogStartupName = "S1AgentWatchdog"
)

func EnsureStartupRegistration(executablePath string) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	if executablePath == "" {
		return fmt.Errorf("empty executable path")
	}

	taskCommand := hiddenLaunchCommand(executablePath)
	registered := false
	registrationErrors := make([]string, 0, 4)

	if err := ensureScheduledTask(currentStartupName, taskCommand, []string{"/SC", "ONLOGON"}); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureScheduledTask(currentBootStartupName, taskCommand, []string{"/SC", "ONSTART"}); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureScheduledTask(currentWatchdogStartupName, taskCommand, []string{"/SC", "MINUTE", "/MO", "1"}); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureRunKey(executablePath); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if registered {
		return nil
	}

	return fmt.Errorf("register startup launchers: %s", strings.Join(registrationErrors, "; "))
}

func ensureScheduledTask(taskName string, taskCommand string, scheduleArgs []string) error {
	args := []string{"/Create", "/TN", taskName}
	args = append(args, scheduleArgs...)
	args = append(args, "/RL", "LIMITED", "/TR", taskCommand, "/F")

	cmd := exec.Command("schtasks", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("register startup task %s: %w", taskName, err)
		}

		return fmt.Errorf("register startup task %s: %w: %s", taskName, err, trimmed)
	}

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
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("register startup run key: %w", err)
		}

		return fmt.Errorf("register startup run key: %w: %s", err, trimmed)
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
