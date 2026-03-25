//go:build !windows

package updater

import "os/exec"

func configureHiddenProcess(cmd *exec.Cmd) {}
