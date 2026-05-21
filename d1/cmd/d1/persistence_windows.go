//go:build windows

package main

import (
	"fmt"

	"github.com/charliearnerstal/cordyceps/d1/internal/resilience"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func ensureWindowsPersistenceServices(opts agentOptions, paths resilience.Paths, executableResolved bool, executablePath string) (bool, error) {
	if !executableResolved || executablePath == "" || !opts.startup || opts.foreground || opts.runAgent || opts.enrollOnly {
		return false, nil
	}

	if !isCurrentUserAdministrator() {
		return false, nil
	}

	if err := ensureGuardianPresentAndRunning(executablePath, paths); err != nil {
		return false, err
	}

	return ensureAgentWindowsServiceRunning(agentOptions{
		serverURL:       opts.serverURL,
		deviceID:        opts.deviceID,
		displayName:     opts.displayName,
		bootstrapToken:  opts.bootstrapToken,
		version:         opts.version,
		configPath:      paths.ConfigPath,
		installRoot:     paths.InstallRoot,
		programDataRoot: paths.ProgramDataRoot,
		slotName:        opts.slotName,
		versionExplicit: opts.versionExplicit,
	})
}

func ensureAgentWindowsServiceRunning(opts agentOptions) (bool, error) {
	manager, err := mgr.Connect()
	if err != nil {
		return false, fmt.Errorf("connect to agent service manager: %w", err)
	}
	defer manager.Disconnect()

	service, err := manager.OpenService(d1ServiceName)
	if err != nil {
		if err := installWindowsService(opts); err != nil {
			return false, fmt.Errorf("install agent Windows service: %w", err)
		}

		service, err = manager.OpenService(d1ServiceName)
		if err != nil {
			return false, fmt.Errorf("open agent Windows service after install: %w", err)
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
		return false, fmt.Errorf("start agent Windows service: %w", err)
	}

	return true, nil
}
