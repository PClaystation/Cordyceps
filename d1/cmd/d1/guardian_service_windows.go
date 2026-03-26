//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const guardianServiceName = "CordycepsD1Guardian"

func ensureGuardianWindowsServiceRunning(guardianExecutablePath string, paths resilience.Paths) (bool, error) {
	if !isCurrentUserAdministrator() {
		return false, nil
	}

	manager, err := mgr.Connect()
	if err != nil {
		return false, fmt.Errorf("connect to guardian service manager: %w", err)
	}
	defer manager.Disconnect()

	service, err := manager.OpenService(guardianServiceName)
	if err != nil {
		installArgs := []string{
			"--install",
			"--config", paths.ConfigPath,
			"--install-root", paths.InstallRoot,
			"--program-data-root", paths.ProgramDataRoot,
			"--startup",
		}

		cmd := exec.Command(guardianExecutablePath, installArgs...)
		configureHiddenProcess(cmd)
		if output, installErr := cmd.CombinedOutput(); installErr != nil {
			trimmed := strings.TrimSpace(string(output))
			if trimmed == "" {
				return false, fmt.Errorf("install guardian Windows service: %w", installErr)
			}
			return false, fmt.Errorf("install guardian Windows service: %w: %s", installErr, trimmed)
		}

		service, err = manager.OpenService(guardianServiceName)
		if err != nil {
			return false, fmt.Errorf("open guardian Windows service after install: %w", err)
		}
	}
	defer service.Close()

	status, err := service.Query()
	if err == nil && (status.State == svc.Running || status.State == svc.StartPending) {
		return true, nil
	}

	if err := service.Start(); err != nil {
		status, queryErr := service.Query()
		if queryErr == nil && (status.State == svc.Running || status.State == svc.StartPending) {
			return true, nil
		}
		return false, fmt.Errorf("start guardian Windows service: %w", err)
	}

	return true, nil
}

func isCurrentUserAdministrator() bool {
	cmd := exec.Command("whoami", "/groups")
	configureHiddenProcess(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}

	text := string(output)
	return strings.Contains(text, "S-1-5-32-544") || strings.Contains(text, "BUILTIN\\Administrators")
}
