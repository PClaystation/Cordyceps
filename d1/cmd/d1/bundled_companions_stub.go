//go:build !windows || !bundledcompanions

package main

import "os"

func readBundledCompanionFile(string) ([]byte, error) {
	return nil, os.ErrNotExist
}
