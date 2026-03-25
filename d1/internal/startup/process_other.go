//go:build !windows

package startup

import "os/exec"

func configureHiddenProcess(cmd *exec.Cmd) {}
