//go:build windows

package background

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const detachedProcess = 0x00000008

func RelaunchDetached(executablePath string, args []string) error {
	cmd := exec.Command(executablePath, args...)
	cmd.Dir = filepath.Dir(executablePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | detachedProcess,
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	_ = cmd.Process.Release()
	return nil
}

func RelaunchAfterParentExit(executablePath string, args []string) error {
	scriptPath, err := writeDelayedLaunchScript(executablePath, args)
	if err != nil {
		return err
	}

	cmd := exec.Command("cmd.exe", "/C", scriptPath)
	cmd.Dir = filepath.Dir(executablePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | detachedProcess,
	}

	if err := cmd.Start(); err != nil {
		_ = os.Remove(scriptPath)
		return err
	}

	_ = cmd.Process.Release()
	return nil
}

func writeDelayedLaunchScript(executablePath string, args []string) (string, error) {
	scriptPath := filepath.Join(os.TempDir(), fmt.Sprintf("se1-launch-%d.cmd", time.Now().UTC().UnixNano()))
	body := []string{
		"@echo off",
		"setlocal enableextensions",
		"timeout /t 2 /nobreak >nul",
		fmt.Sprintf("start \"\" /D \"%s\" /B \"%s\"%s", escapeCmdValue(filepath.Dir(executablePath)), escapeCmdValue(executablePath), formatCmdArgs(args)),
		"del /f /q \"%~f0\" >nul 2>&1",
		"",
	}

	if err := os.WriteFile(scriptPath, []byte(strings.Join(body, "\r\n")), 0o600); err != nil {
		return "", err
	}

	return scriptPath, nil
}

func formatCmdArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}

	escaped := make([]string, 0, len(args))
	for _, arg := range args {
		escaped = append(escaped, fmt.Sprintf("\"%s\"", escapeCmdValue(arg)))
	}

	return " " + strings.Join(escaped, " ")
}

func escapeCmdValue(value string) string {
	escaped := strings.ReplaceAll(value, "\"", "\"\"")
	escaped = strings.ReplaceAll(escaped, "%", "%%")
	return escaped
}
