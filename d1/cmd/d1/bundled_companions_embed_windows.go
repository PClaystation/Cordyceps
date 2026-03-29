//go:build windows && bundledcompanions

package main

import "embed"

//go:embed bundled/windows-amd64/*.bin
var bundledCompanionFS embed.FS

func readBundledCompanionFile(name string) ([]byte, error) {
	return bundledCompanionFS.ReadFile("bundled/windows-amd64/" + name)
}
