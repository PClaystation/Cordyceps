//go:build windows

package background

import (
	"os/exec"
	"syscall"
)

const detachedProcess = 0x00000008

func RelaunchDetached(executablePath string, args []string) error {
	cmd := exec.Command(executablePath, args...)
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
