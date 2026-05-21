//go:build windows

package updater

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	helperPrefix                   = "t1-agent-helper-"
	helperStartupGracePeriod       = 8 * time.Second
	helperParentExitWait           = 15 * time.Second
	helperSwapRetries              = 45
	helperSwapRetryDelay           = time.Second
	processQueryLimitedInformation = 0x1000
	synchronizeAccess              = 0x00100000
	stillActiveExitCode            = 259
	waitObject0                    = 0x00000000
	waitTimeout                    = 0x00000102
	swHide                         = 0
)

var (
	kernel32DLL             = syscall.NewLazyDLL("kernel32.dll")
	shell32DLL              = syscall.NewLazyDLL("shell32.dll")
	procCloseHandle         = kernel32DLL.NewProc("CloseHandle")
	procGetExitCodeProcess  = kernel32DLL.NewProc("GetExitCodeProcess")
	procOpenProcess         = kernel32DLL.NewProc("OpenProcess")
	procShellExecuteW       = shell32DLL.NewProc("ShellExecuteW")
	procWaitForSingleObject = kernel32DLL.NewProc("WaitForSingleObject")
)

func prepareUpdaterHelper(executablePath string) (string, error) {
	if strings.TrimSpace(executablePath) == "" {
		return "", errors.New("missing updater source executable path")
	}

	if err := cleanupStaleHelpers(); err != nil {
		return "", err
	}

	helperPath := filepath.Join(os.TempDir(), fmt.Sprintf("%s%d.exe", helperPrefix, time.Now().UTC().UnixNano()))
	if err := copyFile(executablePath, helperPath, 0o700); err != nil {
		return "", err
	}

	return helperPath, nil
}

func launchUpdaterHelper(helperPath string, args []string, usePrivilegedHelper bool) error {
	if strings.TrimSpace(helperPath) == "" {
		return errors.New("missing updater helper path")
	}

	if usePrivilegedHelper {
		return shellExecuteHidden(helperPath, args)
	}

	cmd := exec.Command(helperPath, args...)
	cmd.Dir = filepath.Dir(helperPath)
	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}

	return cmd.Process.Release()
}

func ApplyStaged(request StagedApplyRequest) error {
	targetPath := strings.TrimSpace(request.TargetPath)
	stagedPath := strings.TrimSpace(request.StagedPath)
	configPath := strings.TrimSpace(request.ConfigPath)
	launchConfigPath := strings.TrimSpace(request.LaunchConfigPath)
	helperPath := strings.TrimSpace(request.HelperPath)
	version := strings.TrimSpace(request.Version)

	switch {
	case targetPath == "":
		return errors.New("missing update target path")
	case stagedPath == "":
		return errors.New("missing staged package path")
	case configPath == "":
		return errors.New("missing current config path")
	case launchConfigPath == "":
		return errors.New("missing launch config path")
	}

	if err := preflightStagedExecutable(stagedPath); err != nil {
		return err
	}

	_ = waitForProcessExit(request.ParentPID, helperParentExitWait)

	backupPath := targetPath + ".bak"
	if err := swapExecutableWithRetry(targetPath, stagedPath, backupPath); err != nil {
		return err
	}

	if err := launchAndConfirmHealthy(targetPath, launchConfigPath, version, helperPath); err != nil {
		rollbackErr := rollbackExecutableSwap(targetPath, backupPath)
		restartErr := launchWithoutValidation(targetPath, configPath, "", helperPath)
		switch {
		case rollbackErr != nil && restartErr != nil:
			return fmt.Errorf("updated agent failed startup validation: %v; rollback failed: %v; restart failed: %v", err, rollbackErr, restartErr)
		case rollbackErr != nil:
			return fmt.Errorf("updated agent failed startup validation: %v; rollback failed: %v", err, rollbackErr)
		case restartErr != nil:
			return fmt.Errorf("updated agent failed startup validation: %v; rollback restart failed: %v", err, restartErr)
		default:
			return fmt.Errorf("updated agent failed startup validation: %w", err)
		}
	}

	_ = os.Remove(backupPath)
	return nil
}

func cleanupStaleHelpers() error {
	matches, err := filepath.Glob(filepath.Join(os.TempDir(), helperPrefix+"*.exe"))
	if err != nil {
		return fmt.Errorf("enumerate stale updater helpers: %w", err)
	}

	for _, match := range matches {
		_ = os.Remove(match)
	}

	return nil
}

func copyFile(sourcePath string, destinationPath string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o700); err != nil {
		return fmt.Errorf("create helper dir: %w", err)
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open helper source: %w", err)
	}
	defer sourceFile.Close()

	tempPath := destinationPath + ".tmp"
	destinationFile, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return fmt.Errorf("create helper file: %w", err)
	}

	if _, err := io.Copy(destinationFile, sourceFile); err != nil {
		_ = destinationFile.Close()
		_ = os.Remove(tempPath)
		return fmt.Errorf("copy helper executable: %w", err)
	}
	if err := destinationFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close helper file: %w", err)
	}

	_ = os.Remove(destinationPath)
	if err := os.Rename(tempPath, destinationPath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("activate helper file: %w", err)
	}

	return nil
}

func swapExecutableWithRetry(targetPath string, stagedPath string, backupPath string) error {
	_ = os.Remove(backupPath)

	var lastErr error
	for attempt := 0; attempt < helperSwapRetries; attempt++ {
		if err := os.Rename(targetPath, backupPath); err == nil {
			if err := activateStagedExecutable(stagedPath, targetPath); err != nil {
				_ = os.Rename(backupPath, targetPath)
				return err
			}
			return nil
		} else {
			lastErr = err
			time.Sleep(helperSwapRetryDelay)
		}
	}

	if lastErr == nil {
		lastErr = errors.New("timed out waiting for the running agent to release the executable")
	}
	return fmt.Errorf("replace running executable: %w", lastErr)
}

func activateStagedExecutable(stagedPath string, targetPath string) error {
	if err := os.Rename(stagedPath, targetPath); err == nil {
		return nil
	}

	if err := copyFile(stagedPath, targetPath, 0o700); err != nil {
		return fmt.Errorf("activate staged executable: %w", err)
	}
	_ = os.Remove(stagedPath)
	return nil
}

func rollbackExecutableSwap(targetPath string, backupPath string) error {
	_ = os.Remove(targetPath)
	if err := os.Rename(backupPath, targetPath); err == nil {
		return nil
	}

	if err := copyFile(backupPath, targetPath, 0o700); err != nil {
		return fmt.Errorf("restore backup executable: %w", err)
	}
	_ = os.Remove(backupPath)
	return nil
}

func launchAndConfirmHealthy(targetPath string, configPath string, version string, cleanupPath string) error {
	cmd, err := launchTargetCommand(targetPath, configPath, version, cleanupPath)
	if err != nil {
		return err
	}

	deadline := time.Now().Add(helperStartupGracePeriod)
	for time.Now().Before(deadline) {
		running, err := processStillRunning(cmd.Process.Pid)
		if err != nil {
			_ = cmd.Process.Release()
			return err
		}
		if !running {
			_ = cmd.Process.Release()
			return errors.New("updated agent exited during startup")
		}
		time.Sleep(250 * time.Millisecond)
	}

	return cmd.Process.Release()
}

func launchWithoutValidation(targetPath string, configPath string, version string, cleanupPath string) error {
	cmd, err := launchTargetCommand(targetPath, configPath, version, cleanupPath)
	if err != nil {
		return err
	}
	return cmd.Process.Release()
}

func launchTargetCommand(targetPath string, configPath string, version string, cleanupPath string) (*exec.Cmd, error) {
	args := []string{"--config", configPath}
	if version != "" {
		args = append(args, "--version", version)
	}
	if cleanupPath != "" {
		args = append(args, "--cleanup-path", cleanupPath)
	}
	args = append(args, "--run-agent")

	cmd := exec.Command(targetPath, args...)
	cmd.Dir = filepath.Dir(targetPath)
	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("launch target agent: %w", err)
	}

	return cmd, nil
}

func shellExecuteHidden(executablePath string, args []string) error {
	verb, err := syscall.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := syscall.UTF16PtrFromString(executablePath)
	if err != nil {
		return err
	}
	parameters, err := syscall.UTF16PtrFromString(windowsCommandLine(args))
	if err != nil {
		return err
	}
	directory, err := syscall.UTF16PtrFromString(filepath.Dir(executablePath))
	if err != nil {
		return err
	}

	result, _, callErr := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(parameters)),
		uintptr(unsafe.Pointer(directory)),
		swHide,
	)
	if result <= 32 {
		if callErr != syscall.Errno(0) {
			return callErr
		}
		return fmt.Errorf("ShellExecuteW failed with code %d", result)
	}

	return nil
}

func waitForProcessExit(pid int, timeout time.Duration) error {
	if pid <= 0 {
		return nil
	}

	handle, err := openProcessHandle(pid, synchronizeAccess|processQueryLimitedInformation)
	if err != nil {
		return nil
	}
	defer closeWindowsHandle(handle)

	timeoutMillis := uint32(timeout / time.Millisecond)
	result, _, callErr := procWaitForSingleObject.Call(handle, uintptr(timeoutMillis))
	switch result {
	case waitObject0:
		return nil
	case waitTimeout:
		return errors.New("timed out waiting for parent process to exit")
	default:
		if callErr != syscall.Errno(0) {
			return callErr
		}
		return fmt.Errorf("WaitForSingleObject failed with code %d", result)
	}
}

func processStillRunning(pid int) (bool, error) {
	if pid <= 0 {
		return false, nil
	}

	handle, err := openProcessHandle(pid, processQueryLimitedInformation)
	if err != nil {
		return false, nil
	}
	defer closeWindowsHandle(handle)

	var exitCode uint32
	result, _, callErr := procGetExitCodeProcess.Call(handle, uintptr(unsafe.Pointer(&exitCode)))
	if result == 0 {
		if callErr != syscall.Errno(0) {
			return false, callErr
		}
		return false, errors.New("GetExitCodeProcess failed")
	}

	return exitCode == stillActiveExitCode, nil
}

func openProcessHandle(pid int, access uintptr) (uintptr, error) {
	handle, _, callErr := procOpenProcess.Call(access, 0, uintptr(uint32(pid)))
	if handle == 0 {
		if callErr != syscall.Errno(0) {
			return 0, callErr
		}
		return 0, errors.New("OpenProcess failed")
	}

	return handle, nil
}

func closeWindowsHandle(handle uintptr) {
	if handle != 0 {
		procCloseHandle.Call(handle)
	}
}
