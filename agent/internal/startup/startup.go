package startup

import (
	"fmt"
	"os/exec"
	"runtime"
)

func EnsureStartupRegistration(executablePath string) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	if executablePath == "" {
		return fmt.Errorf("empty executable path")
	}

	taskCommand := fmt.Sprintf("\"%s\"", executablePath)

	cmd := exec.Command(
		"schtasks",
		"/Create",
		"/TN",
		"JarvisAgent",
		"/SC",
		"ONLOGON",
		"/RL",
		"LIMITED",
		"/TR",
		taskCommand,
		"/F",
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("register startup task: %w: %s", err, string(output))
	}

	return nil
}
