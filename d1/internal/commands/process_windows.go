//go:build windows

package commands

import (
	"os/exec"
	"syscall"
)

const detachedProcess = 0x00000008

func configureHiddenProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | detachedProcess,
	}
}
