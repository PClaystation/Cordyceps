//go:build !windows

package main

import "os/exec"

func configureHiddenProcess(cmd *exec.Cmd) {}
