package startup

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

const (
	currentTaskName         = "CordycepsAgent"
	currentBootTaskName     = "CordycepsAgentBoot"
	currentWatchdogTaskName = "CordycepsAgentWatchdog"
	currentRunKey           = "CordycepsAgent"
)

func EnsureStartupRegistration(executablePath string) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	if executablePath == "" {
		return fmt.Errorf("empty executable path")
	}

	taskCommand := startupCommand(executablePath)
	registered := false
	registrationErrors := make([]string, 0, 4)

	if err := ensureScheduledTask(currentTaskName, taskCommand, []string{"/SC", "ONLOGON"}); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureScheduledTask(currentBootTaskName, taskCommand, []string{"/SC", "ONSTART"}); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureScheduledTask(currentWatchdogTaskName, taskCommand, []string{"/SC", "MINUTE", "/MO", "1"}); err != nil {
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
	configureHiddenProcess(cmd)
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
	cmd := exec.Command(
		"reg",
		"add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		currentRunKey,
		"/t",
		"REG_SZ",
		"/d",
		startupCommand(executablePath),
		"/f",
	)
	configureHiddenProcess(cmd)

	if output, err := cmd.CombinedOutput(); err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("register startup run key: %w", err)
		}

		return fmt.Errorf("register startup run key: %w: %s", err, trimmed)
	}

	return nil
}

func startupCommand(executablePath string) string {
	return fmt.Sprintf(`"%s" --run-agent --startup`, executablePath)
}
