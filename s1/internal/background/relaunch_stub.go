//go:build !windows

package background

import "errors"

func RelaunchDetached(_ string, _ []string) error {
	return errors.New("detached relaunch is only supported on windows")
}

func RelaunchAfterParentExit(_ string, _ []string) error {
	return errors.New("delayed relaunch is only supported on windows")
}
