//go:build windows

package startup

import (
	"os/exec"
	"syscall"
)

func configureHiddenProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
}
