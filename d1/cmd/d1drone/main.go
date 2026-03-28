package main

import (
	"flag"
	"fmt"
	"log"
	"strings"

	"github.com/charliearnerstal/jarvis/d1/internal/drone"
)

var droneVersion = "0.1.0"
var defaultRole = ""

type options struct {
	role            string
	configPath      string
	installRoot     string
	programDataRoot string
	foreground      bool
	printVersion    bool
}

func main() {
	opts := parseOptions()
	if opts.printVersion {
		fmt.Println(strings.TrimSpace(droneVersion))
		return
	}

	log.SetFlags(log.LstdFlags | log.LUTC)
	if err := drone.Run(drone.Options{
		Role:            opts.role,
		Version:         strings.TrimSpace(droneVersion),
		ConfigPath:      opts.configPath,
		InstallRoot:     opts.installRoot,
		ProgramDataRoot: opts.programDataRoot,
		Foreground:      opts.foreground,
	}); err != nil {
		log.Fatal(err)
	}
}

func parseOptions() options {
	var opts options
	flag.StringVar(&opts.role, "role", "", "Drone role number")
	flag.StringVar(&opts.configPath, "config", "", "Path to the d1 agent config file")
	flag.StringVar(&opts.installRoot, "install-root", "", "Managed d1 install root")
	flag.StringVar(&opts.programDataRoot, "program-data-root", "", "Managed d1 program data root")
	flag.BoolVar(&opts.foreground, "foreground", false, "Run the drone in the current console")
	flag.BoolVar(&opts.printVersion, "print-version", false, "Print drone version and exit")
	flag.Parse()

	opts.role = strings.TrimSpace(opts.role)
	if opts.role == "" {
		opts.role = strings.TrimSpace(defaultRole)
	}
	opts.configPath = strings.TrimSpace(opts.configPath)
	opts.installRoot = strings.TrimSpace(opts.installRoot)
	opts.programDataRoot = strings.TrimSpace(opts.programDataRoot)
	return opts
}
