//go:build !windows

package updater

import "errors"

func prepareUpdaterHelper(_ string) (string, error) {
	return "", errors.New("AGENT_UPDATE is supported only on Windows")
}

func launchUpdaterHelper(_ string, _ []string, _ bool) error {
	return errors.New("AGENT_UPDATE is supported only on Windows")
}

func ApplyStaged(_ StagedApplyRequest) error {
	return errors.New("AGENT_UPDATE is supported only on Windows")
}
