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
	d1ServiceName        = "CordycepsDS1"
	d1ServiceDisplayName = "Cordyceps ds-family Resident Helper (ds1)"
	d1ServiceDescription = "Runs the personal ds-family resident helper for ds1 as a Windows service."

	serviceRecoveryDelay       = 5 * time.Second
	serviceRecoveryResetPeriod = 24 * 60 * 60

	eventIDServiceStarting = 1
	eventIDServiceRunning  = 2
	eventIDServiceStopping = 3
	eventIDServiceStopped  = 4
	eventIDServiceWarning  = 5
	eventIDServiceError    = 6
)

type serviceLogger interface {
	Close() error
	Info(eid uint32, msg string) error
	Warning(eid uint32, msg string) error
	Error(eid uint32, msg string) error
}

type d1WindowsService struct {
	opts agentOptions
	log  serviceLogger
}

func handleWindowsService(opts agentOptions) (bool, error) {
	if opts.installService && opts.uninstallSvc {
		return true, fmt.Errorf("use only one of -install or -uninstall")
	}

	if opts.installService {
		if opts.enrollOnly {
			return true, fmt.Errorf("-install and -enroll-only cannot be used together")
		}
		return true, installWindowsService(opts)
	}

	if opts.uninstallSvc {
		return true, uninstallWindowsService()
	}

	if opts.interactiveSvc {
		return true, runWindowsServiceInteractive(opts)
	}

	isService, err := svc.IsWindowsService()
	if err != nil {
		return true, fmt.Errorf("detect Windows service context: %w", err)
	}
	if !isService {
		return false, nil
	}

	return true, runWindowsService(opts)
}

func runWindowsService(opts agentOptions) error {
	elog, err := eventlog.Open(d1ServiceName)
	if err != nil {
		return fmt.Errorf("open Windows event log: %w", err)
	}
	defer elog.Close()

	return svc.Run(d1ServiceName, &d1WindowsService{opts: opts, log: elog})
}

func runWindowsServiceInteractive(opts agentOptions) error {
	consoleLog := debug.New(d1ServiceName)
	defer consoleLog.Close()

	return debug.Run(d1ServiceName, &d1WindowsService{opts: opts, log: consoleLog})
}

func (service *d1WindowsService) Execute(args []string, requests <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const acceptedCommands = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}
	service.info(eventIDServiceStarting, "ds1 Windows service is starting")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	executablePath, executableResolved := currentExecutablePath()
	agentDone := make(chan error, 1)
	go func() {
		agentDone <- runAgentHost(ctx, service.opts, executablePath, executableResolved, false)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: acceptedCommands}
	service.info(eventIDServiceRunning, "ds1 Windows service is running")

	for {
		select {
		case change := <-requests:
			switch change.Cmd {
			case svc.Interrogate:
				changes <- change.CurrentStatus
			case svc.Stop, svc.Shutdown:
				service.info(eventIDServiceStopping, "ds1 Windows service stop requested")
				changes <- svc.Status{State: svc.StopPending}
				cancel()

				if err := <-agentDone; err != nil {
					service.error(eventIDServiceError, fmt.Sprintf("ds1 Windows service stopped with error: %v", err))
					return false, 1
				}

				service.info(eventIDServiceStopped, "ds1 Windows service stopped cleanly")
				return false, 0
			default:
				service.warning(eventIDServiceWarning, fmt.Sprintf("ignoring service control request %d", change.Cmd))
			}
		case err := <-agentDone:
			changes <- svc.Status{State: svc.StopPending}
			if err != nil {
				service.error(eventIDServiceError, fmt.Sprintf("ds1 agent loop exited with error: %v", err))
				return false, 1
			}

			service.warning(eventIDServiceWarning, "ds1 agent loop exited; stopping Windows service")
			return false, 0
		}
	}
}

func installWindowsService(opts agentOptions) error {
	executablePath, err := executablePathForInstall()
	if err != nil {
		return err
	}

	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer manager.Disconnect()

	existing, err := manager.OpenService(d1ServiceName)
	if err == nil {
		existing.Close()
		return fmt.Errorf("service %q is already installed", d1ServiceName)
	}

	service, err := manager.CreateService(
		d1ServiceName,
		executablePath,
		mgr.Config{
			StartType:   mgr.StartAutomatic,
			DisplayName: d1ServiceDisplayName,
			Description: d1ServiceDescription,
		},
		serviceInstallArgs(opts)...,
	)
	if err != nil {
		return fmt.Errorf("create Windows service: %w", err)
	}
	defer service.Close()

	if err := eventlog.InstallAsEventCreate(d1ServiceName, eventlog.Error|eventlog.Warning|eventlog.Info); err != nil {
		_ = service.Delete()
		return fmt.Errorf("register event log source: %w", err)
	}

	if err := configureServiceRecovery(service); err != nil {
		_ = eventlog.Remove(d1ServiceName)
		_ = service.Delete()
		return fmt.Errorf("configure service recovery: %w", err)
	}

	return nil
}

func uninstallWindowsService() error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer manager.Disconnect()

	service, err := manager.OpenService(d1ServiceName)
	if err != nil {
		return fmt.Errorf("open Windows service %q: %w", d1ServiceName, err)
	}
	defer service.Close()

	if err := stopWindowsService(service); err != nil {
		return err
	}

	if err := service.Delete(); err != nil {
		return fmt.Errorf("delete Windows service %q: %w", d1ServiceName, err)
	}

	if err := eventlog.Remove(d1ServiceName); err != nil {
		log.Printf("warning: remove event log source %s failed: %v", d1ServiceName, err)
	}

	return nil
}

func stopWindowsService(service *mgr.Service) error {
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

	return fmt.Errorf("timeout waiting for Windows service %q to stop", d1ServiceName)
}

func serviceInstallArgs(opts agentOptions) []string {
	args := make([]string, 0, 10)

	if opts.configPath != "" {
		args = append(args, "--config", opts.configPath)
	}
	if opts.serverURL != "" {
		args = append(args, "--server-url", opts.serverURL)
	}
	if opts.deviceID != "" {
		args = append(args, "--device-id", opts.deviceID)
	}
	if opts.displayName != "" {
		args = append(args, "--display-name", opts.displayName)
	}
	if opts.bootstrapToken != "" {
		args = append(args, "--bootstrap-token", opts.bootstrapToken)
	}
	if opts.versionExplicit && opts.version != "" {
		args = append(args, "--version", opts.version)
	}

	return args
}

func configureServiceRecovery(service *mgr.Service) error {
	recoveryActions := []mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: serviceRecoveryDelay},
		{Type: mgr.ServiceRestart, Delay: serviceRecoveryDelay},
		{Type: mgr.ServiceRestart, Delay: serviceRecoveryDelay},
	}

	if err := service.SetRecoveryActions(recoveryActions, serviceRecoveryResetPeriod); err != nil {
		return err
	}

	if err := service.SetRecoveryActionsOnNonCrashFailures(true); err != nil {
		return err
	}

	return nil
}

func repairWindowsServiceIfInstalled() error {
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer manager.Disconnect()

	service, err := manager.OpenService(d1ServiceName)
	if err != nil {
		return nil
	}
	defer service.Close()

	if err := configureServiceRecovery(service); err != nil {
		return fmt.Errorf("repair service recovery: %w", err)
	}

	return nil
}

func executablePathForInstall() (string, error) {
	executablePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}

	return executablePath, nil
}

func (service *d1WindowsService) info(eventID uint32, message string) {
	if service.log == nil {
		return
	}
	_ = service.log.Info(eventID, message)
}

func (service *d1WindowsService) warning(eventID uint32, message string) {
	if service.log == nil {
		return
	}
	_ = service.log.Warning(eventID, message)
}

func (service *d1WindowsService) error(eventID uint32, message string) {
	if service.log == nil {
		return
	}
	_ = service.log.Error(eventID, message)
}
