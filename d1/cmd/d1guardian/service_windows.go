//go:build windows

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/debug"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	guardianServiceName        = "CordycepsD1Guardian"
	guardianServiceDisplayName = "Cordyceps D1 Guardian"
	guardianServiceDescription = "Keeps the d-family updater agent running, staged, and recoverable."

	guardianServiceRecoveryDelay       = 5 * time.Second
	guardianServiceRecoveryResetPeriod = 24 * 60 * 60

	guardianEventIDServiceStarting = 1
	guardianEventIDServiceRunning  = 2
	guardianEventIDServiceStopping = 3
	guardianEventIDServiceStopped  = 4
	guardianEventIDServiceWarning  = 5
	guardianEventIDServiceError    = 6
)

type guardianServiceLogger interface {
	Close() error
	Info(eid uint32, msg string) error
	Warning(eid uint32, msg string) error
	Error(eid uint32, msg string) error
}

type guardianWindowsService struct {
	opts guardianOptions
	log  guardianServiceLogger
}

func handleGuardianWindowsService(opts guardianOptions) (bool, error) {
	if opts.installService && opts.uninstallSvc {
		return true, fmt.Errorf("use only one of -install or -uninstall")
	}

	if opts.installService {
		return true, installGuardianWindowsService(opts)
	}
	if opts.uninstallSvc {
		return true, uninstallGuardianWindowsService()
	}
	if opts.interactiveSvc {
		return true, runGuardianWindowsServiceInteractive(opts)
	}

	isService, err := svc.IsWindowsService()
	if err != nil {
		return true, fmt.Errorf("detect Windows service context: %w", err)
	}
	if !isService {
		return false, nil
	}

	return true, runGuardianWindowsService(opts)
}

func runGuardianWindowsService(opts guardianOptions) error {
	elog, err := eventlog.Open(guardianServiceName)
	if err != nil {
		return fmt.Errorf("open Windows event log: %w", err)
	}
	defer elog.Close()

	return svc.Run(guardianServiceName, &guardianWindowsService{opts: opts, log: elog})
}

func runGuardianWindowsServiceInteractive(opts guardianOptions) error {
	consoleLog := debug.New(guardianServiceName)
	defer consoleLog.Close()

	return debug.Run(guardianServiceName, &guardianWindowsService{opts: opts, log: consoleLog})
}

func (service *guardianWindowsService) Execute(args []string, requests <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const acceptedCommands = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}
	service.info(guardianEventIDServiceStarting, "d1 guardian Windows service is starting")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	guardianDone := make(chan error, 1)
	go func() {
		guardianDone <- runGuardian(service.opts)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: acceptedCommands}
	service.info(guardianEventIDServiceRunning, "d1 guardian Windows service is running")

	for {
		select {
		case change := <-requests:
			switch change.Cmd {
			case svc.Interrogate:
				changes <- change.CurrentStatus
			case svc.Stop, svc.Shutdown:
				service.info(guardianEventIDServiceStopping, "d1 guardian service stop requested")
				changes <- svc.Status{State: svc.StopPending}
				cancel()

				if err := <-guardianDone; err != nil {
					service.error(guardianEventIDServiceError, fmt.Sprintf("d1 guardian service stopped with error: %v", err))
					return false, 1
				}

				service.info(guardianEventIDServiceStopped, "d1 guardian service stopped cleanly")
				return false, 0
			default:
				service.warning(guardianEventIDServiceWarning, fmt.Sprintf("ignoring service control request %d", change.Cmd))
			}
		case err := <-guardianDone:
			changes <- svc.Status{State: svc.StopPending}
			if err != nil {
				service.error(guardianEventIDServiceError, fmt.Sprintf("d1 guardian loop exited with error: %v", err))
				return false, 1
			}

			service.warning(guardianEventIDServiceWarning, "d1 guardian loop exited; stopping Windows service")
			return false, 0
		}
	}
}

func installGuardianWindowsService(opts guardianOptions) error {
	executablePath, err := executablePathForGuardianInstall()
	if err != nil {
		return err
	}

	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer manager.Disconnect()

	existing, err := manager.OpenService(guardianServiceName)
	if err == nil {
		existing.Close()
		return fmt.Errorf("service %q is already installed", guardianServiceName)
	}

	service, err := manager.CreateService(
		guardianServiceName,
		executablePath,
		mgr.Config{
			StartType:   mgr.StartAutomatic,
			DisplayName: guardianServiceDisplayName,
			Description: guardianServiceDescription,
		},
		guardianServiceInstallArgs(opts)...,
	)
	if err != nil {
		return fmt.Errorf("create Windows service: %w", err)
	}
	defer service.Close()

	if err := eventlog.InstallAsEventCreate(guardianServiceName, eventlog.Error|eventlog.Warning|eventlog.Info); err != nil {
		_ = service.Delete()
		return fmt.Errorf("register event log source: %w", err)
	}

	if err := configureGuardianServiceRecovery(service); err != nil {
		_ = eventlog.Remove(guardianServiceName)
		_ = service.Delete()
		return fmt.Errorf("configure service recovery: %w", err)
	}

	return nil
}

func uninstallGuardianWindowsService() error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer manager.Disconnect()

	service, err := manager.OpenService(guardianServiceName)
	if err != nil {
		return fmt.Errorf("open Windows service %q: %w", guardianServiceName, err)
	}
	defer service.Close()

	if err := stopGuardianWindowsService(service); err != nil {
		return err
	}
	if err := service.Delete(); err != nil {
		return fmt.Errorf("delete Windows service %q: %w", guardianServiceName, err)
	}

	if err := eventlog.Remove(guardianServiceName); err != nil {
		log.Printf("warning: remove event log source %s failed: %v", guardianServiceName, err)
	}

	return nil
}

func stopGuardianWindowsService(service *mgr.Service) error {
	status, err := service.Query()
	if err != nil {
		return fmt.Errorf("query Windows service state: %w", err)
	}
	if status.State == svc.Stopped {
		return nil
	}

	if _, err := service.Control(svc.Stop); err != nil {
		return fmt.Errorf("stop Windows service: %w", err)
	}

	timeout := time.Now().Add(15 * time.Second)
	for time.Now().Before(timeout) {
		time.Sleep(300 * time.Millisecond)
		status, err = service.Query()
		if err != nil {
			return fmt.Errorf("query Windows service state after stop: %w", err)
		}
		if status.State == svc.Stopped {
			return nil
		}
	}
	return fmt.Errorf("timeout waiting for Windows service %q to stop", guardianServiceName)
}

func guardianServiceInstallArgs(opts guardianOptions) []string {
	args := make([]string, 0, 8)
	if opts.configPath != "" {
		args = append(args, "--config", opts.configPath)
	}
	if opts.installRoot != "" {
		args = append(args, "--install-root", opts.installRoot)
	}
	if opts.programDataRoot != "" {
		args = append(args, "--program-data-root", opts.programDataRoot)
	}
	if opts.startup {
		args = append(args, "--startup")
	}
	return args
}

func configureGuardianServiceRecovery(service *mgr.Service) error {
	recoveryActions := []mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: guardianServiceRecoveryDelay},
		{Type: mgr.ServiceRestart, Delay: guardianServiceRecoveryDelay},
		{Type: mgr.ServiceRestart, Delay: guardianServiceRecoveryDelay},
	}

	if err := service.SetRecoveryActions(recoveryActions, guardianServiceRecoveryResetPeriod); err != nil {
		return err
	}
	return service.SetRecoveryActionsOnNonCrashFailures(true)
}

func repairGuardianWindowsServiceIfInstalled() error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer manager.Disconnect()

	service, err := manager.OpenService(guardianServiceName)
	if err != nil {
		return nil
	}
	defer service.Close()

	if err := configureGuardianServiceRecovery(service); err != nil {
		return fmt.Errorf("repair service recovery: %w", err)
	}
	return nil
}

func executablePathForGuardianInstall() (string, error) {
	executablePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	return executablePath, nil
}

func (service *guardianWindowsService) info(eventID uint32, message string) {
	if service.log != nil {
		_ = service.log.Info(eventID, message)
	}
}

func (service *guardianWindowsService) warning(eventID uint32, message string) {
	if service.log != nil {
		_ = service.log.Warning(eventID, message)
	}
}

func (service *guardianWindowsService) error(eventID uint32, message string) {
	if service.log != nil {
		_ = service.log.Error(eventID, message)
	}
}
