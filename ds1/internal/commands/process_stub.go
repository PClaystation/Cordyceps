//go:build !windows

package commands

import "os/exec"

func configureHiddenProcess(_ *exec.Cmd) {}
