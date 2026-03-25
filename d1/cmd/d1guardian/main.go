package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/background"
	"github.com/charliearnerstal/jarvis/d1/internal/config"
	"github.com/charliearnerstal/jarvis/d1/internal/instance"
	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
	"github.com/charliearnerstal/jarvis/d1/internal/startup"
)

var guardianVersion = "0.1.0"

const guardianLockSuffix = "#guardian"

type guardianOptions struct {
	configPath      string
	installRoot     string
	programDataRoot string
	startup         bool
	foreground      bool
	installService  bool
	uninstallSvc    bool
	interactiveSvc  bool
	printVersion    bool
}

func main() {
	opts := parseGuardianOptions()
	if opts.printVersion {
		fmt.Println(strings.TrimSpace(guardianVersion))
		return
	}

	log.SetFlags(log.LstdFlags | log.LUTC)
	if !opts.foreground {
		configureGuardianLogging()
	}

	if handled, err := handleGuardianWindowsService(opts); handled {
		if err != nil {
			log.Fatal(err)
		}
		return
	}

	if err := runGuardian(opts); err != nil {
		log.Fatal(err)
	}
}

func parseGuardianOptions() guardianOptions {
	var opts guardianOptions
	flag.StringVar(&opts.configPath, "config", "", "Path to the d1 agent config file")
	flag.StringVar(&opts.installRoot, "install-root", "", "Managed d1 install root")
	flag.StringVar(&opts.programDataRoot, "program-data-root", "", "Guardian state and fallback root")
	flag.BoolVar(&opts.startup, "startup", true, "Register guardian startup persistence")
	flag.BoolVar(&opts.foreground, "foreground", false, "Run guardian in the current console")
	flag.BoolVar(&opts.installService, "install", false, "Install guardian as a Windows service")
	flag.BoolVar(&opts.uninstallSvc, "uninstall", false, "Uninstall guardian Windows service")
	flag.BoolVar(&opts.interactiveSvc, "interactive", false, "Run guardian service handler interactively for testing")
	flag.BoolVar(&opts.printVersion, "print-version", false, "Print guardian version and exit")
	flag.Parse()

	opts.configPath = strings.TrimSpace(opts.configPath)
	opts.installRoot = strings.TrimSpace(opts.installRoot)
	opts.programDataRoot = strings.TrimSpace(opts.programDataRoot)
	return opts
}

func runGuardian(opts guardianOptions) error {
	paths, err := resilience.ResolvePaths(opts.configPath, opts.installRoot, opts.programDataRoot)
	if err != nil {
		return fmt.Errorf("resolve guardian paths: %w", err)
	}

	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve guardian executable path: %w", err)
	}

	if installed, err := installAndRelaunchGuardianIfNeeded(executablePath, paths, opts); err != nil {
		log.Printf("warning: guardian self-install failed; continuing in current location: %v", err)
	} else if installed {
		return nil
	}

	lock, err := instance.Acquire(paths.ConfigPath + guardianLockSuffix)
	if err != nil {
		if errors.Is(err, instance.ErrAlreadyRunning) {
			return nil
		}
		return fmt.Errorf("acquire guardian instance lock: %w", err)
	}
	defer func() {
		if releaseErr := lock.Release(); releaseErr != nil {
			log.Printf("warning: release guardian instance lock failed: %v", releaseErr)
		}
	}()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := reconcileGuardian(paths, opts.startup); err != nil {
		log.Printf("warning: initial guardian reconcile failed: %v", err)
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := reconcileGuardian(paths, opts.startup); err != nil {
				log.Printf("warning: guardian reconcile failed: %v", err)
			}
		}
	}
}

func installAndRelaunchGuardianIfNeeded(executablePath string, paths resilience.Paths, opts guardianOptions) (bool, error) {
	if executablePath == "" {
		return false, nil
	}

	targetPath := resilience.GuardianExecutablePath(paths)
	if samePath(executablePath, targetPath) {
		return false, nil
	}

	if err := resilience.CopyExecutable(executablePath, targetPath); err != nil {
		return false, fmt.Errorf("copy guardian executable: %w", err)
	}

	args := []string{
		"--config", paths.ConfigPath,
		"--install-root", paths.InstallRoot,
		"--program-data-root", paths.ProgramDataRoot,
	}
	if opts.startup {
		args = append(args, "--startup")
	}
	if opts.foreground {
		args = append(args, "--foreground")
	}

	if err := background.RelaunchDetached(targetPath, args); err != nil {
		return false, fmt.Errorf("launch installed guardian: %w", err)
	}

	return true, nil
}

func reconcileGuardian(paths resilience.Paths, registerStartup bool) error {
	state, err := resilience.LoadState(paths)
	if err != nil {
		return fmt.Errorf("load guardian state: %w", err)
	}

	if registerStartup {
		if err := startup.RepairRegistrationIfMissing(guardianRegistrationSpec(paths)); err != nil {
			return fmt.Errorf("repair guardian startup registration: %w", err)
		}
	}

	if err := repairGuardianWindowsServiceIfInstalled(); err != nil {
		return fmt.Errorf("repair guardian Windows service: %w", err)
	}

	if err := ensureBaseImages(paths, state); err != nil {
		return fmt.Errorf("ensure managed binaries: %w", err)
	}

	if err := adoptPendingRollout(paths, state); err != nil {
		return fmt.Errorf("adopt rollout request: %w", err)
	}

	health, err := resilience.LoadHealth(paths)
	if err != nil {
		return fmt.Errorf("load health state: %w", err)
	}

	heartbeatSeconds := loadHeartbeatSeconds(paths.ConfigPath)
	staleDeadline := time.Now().Add(-(time.Duration(heartbeatSeconds*3) * time.Second))

	if state.Pending != nil {
		if healthMatchesPending(health, state.Pending) {
			state.ActiveSlot = resilience.NormalizeSlot(state.Pending.TargetSlot)
			state.LastHealthySlot = state.ActiveSlot
			state.LastHealthyVersion = strings.TrimSpace(health.Version)
			state.LastHealthyAt = strings.TrimSpace(health.AckedAt)
			state.Pending = nil
			if err := resilience.SaveState(paths, state); err != nil {
				return fmt.Errorf("commit rollout state: %w", err)
			}
			if err := refreshFallback(paths, state.ActiveSlot); err != nil {
				return fmt.Errorf("refresh fallback after rollout: %w", err)
			}
			return nil
		}

		if time.Now().After(resilience.ParseTimestamp(state.Pending.Deadline)) {
			state.ActiveSlot = resilience.NormalizeSlot(state.Pending.PreviousSlot)
			state.Pending = nil
			if err := resilience.SaveState(paths, state); err != nil {
				return fmt.Errorf("rollback rollout state: %w", err)
			}
			return launchSlot(paths, state.ActiveSlot)
		}

		return launchSlot(paths, state.Pending.TargetSlot)
	}

	activeSlot := resilience.NormalizeSlot(state.ActiveSlot)
	if isHealthFreshForSlot(health, activeSlot, staleDeadline) {
		if state.LastHealthySlot != activeSlot || state.LastHealthyVersion != strings.TrimSpace(health.Version) {
			state.LastHealthySlot = activeSlot
			state.LastHealthyVersion = strings.TrimSpace(health.Version)
			state.LastHealthyAt = strings.TrimSpace(health.AckedAt)
			if err := resilience.SaveState(paths, state); err != nil {
				return fmt.Errorf("save guardian health state: %w", err)
			}
			if err := refreshFallback(paths, activeSlot); err != nil {
				return fmt.Errorf("refresh fallback: %w", err)
			}
		}
		return nil
	}

	return launchSlot(paths, activeSlot)
}

func ensureBaseImages(paths resilience.Paths, state *resilience.State) error {
	if state == nil {
		state = resilience.DefaultState()
	}

	activeSlot := resilience.NormalizeSlot(state.ActiveSlot)
	activePath := resilience.SlotExecutablePath(paths, activeSlot)
	activeMissing, err := resilience.MissingOrInvalidExecutable(activePath)
	if err != nil {
		return err
	}

	if activeMissing {
		fallbackMissing, err := resilience.MissingOrInvalidExecutable(resilience.FallbackAgentPath(paths))
		if err != nil {
			return err
		}
		if !fallbackMissing {
			if err := resilience.CopyExecutable(resilience.FallbackAgentPath(paths), activePath); err != nil {
				return err
			}
		}
	}

	if missing, err := resilience.MissingOrInvalidExecutable(activePath); err != nil {
		return err
	} else if missing {
		legacyPath := resilience.LegacyAgentPath(paths)
		if legacyMissing, err := resilience.MissingOrInvalidExecutable(legacyPath); err != nil {
			return err
		} else if !legacyMissing {
			if err := resilience.CopyExecutable(legacyPath, activePath); err != nil {
				return err
			}
		}
	}

	fallbackPath := resilience.FallbackAgentPath(paths)
	if fallbackMissing, err := resilience.MissingOrInvalidExecutable(fallbackPath); err != nil {
		return err
	} else if fallbackMissing {
		if activeMissing, err := resilience.MissingOrInvalidExecutable(activePath); err != nil {
			return err
		} else if !activeMissing {
			if err := resilience.CopyExecutable(activePath, fallbackPath); err != nil {
				return err
			}
		}
	}

	return resilience.SaveState(paths, state)
}

func adoptPendingRollout(paths resilience.Paths, state *resilience.State) error {
	request, err := resilience.LoadRolloutRequest(paths)
	if err != nil {
		return err
	}
	if request == nil {
		return nil
	}

	heartbeatSeconds := loadHeartbeatSeconds(paths.ConfigPath)
	requestedAt := resilience.ParseTimestamp(request.RequestedAt)
	if requestedAt.IsZero() {
		requestedAt = time.Now().UTC()
	}

	state.Pending = &resilience.PendingRollout{
		TargetSlot:    resilience.NormalizeSlot(request.TargetSlot),
		PreviousSlot:  resilience.NormalizeSlot(request.PreviousSlot),
		TargetVersion: strings.TrimSpace(request.TargetVersion),
		RequestedAt:   requestedAt.Format(time.RFC3339),
		Deadline:      requestedAt.Add(time.Duration(heartbeatSeconds*4)*time.Second + 30*time.Second).Format(time.RFC3339),
	}
	if err := resilience.SaveState(paths, state); err != nil {
		return err
	}
	return resilience.DeleteRolloutRequest(paths)
}

func refreshFallback(paths resilience.Paths, slot string) error {
	slotPath := resilience.SlotExecutablePath(paths, slot)
	missing, err := resilience.MissingOrInvalidExecutable(slotPath)
	if err != nil {
		return err
	}
	if missing {
		return nil
	}
	return resilience.CopyExecutable(slotPath, resilience.FallbackAgentPath(paths))
}

func launchSlot(paths resilience.Paths, slot string) error {
	executablePath := resilience.SlotExecutablePath(paths, slot)
	missing, err := resilience.MissingOrInvalidExecutable(executablePath)
	if err != nil {
		return err
	}
	if missing {
		return fmt.Errorf("slot %s executable is missing", slot)
	}

	return background.RelaunchDetached(executablePath, []string{
		"--config", paths.ConfigPath,
		"--install-root", paths.InstallRoot,
		"--program-data-root", paths.ProgramDataRoot,
		"--slot", resilience.NormalizeSlot(slot),
		"--run-agent",
		"--startup",
	})
}

func healthMatchesPending(health *resilience.Health, pending *resilience.PendingRollout) bool {
	if health == nil || pending == nil {
		return false
	}
	if resilience.NormalizeSlot(health.Slot) != resilience.NormalizeSlot(pending.TargetSlot) {
		return false
	}
	if strings.TrimSpace(pending.TargetVersion) != "" && strings.TrimSpace(health.Version) != strings.TrimSpace(pending.TargetVersion) {
		return false
	}

	ackedAt := resilience.ParseTimestamp(health.AckedAt)
	requestedAt := resilience.ParseTimestamp(pending.RequestedAt)
	return !ackedAt.IsZero() && !requestedAt.IsZero() && !ackedAt.Before(requestedAt)
}

func isHealthFreshForSlot(health *resilience.Health, slot string, staleDeadline time.Time) bool {
	if health == nil {
		return false
	}
	if resilience.NormalizeSlot(health.Slot) != resilience.NormalizeSlot(slot) {
		return false
	}
	ackedAt := resilience.ParseTimestamp(health.AckedAt)
	return !ackedAt.IsZero() && ackedAt.After(staleDeadline)
}

func loadHeartbeatSeconds(cfgPath string) int {
	cfg, err := config.Load(cfgPath)
	if err != nil || cfg == nil || cfg.HeartbeatSeconds <= 0 {
		return 60
	}
	return cfg.HeartbeatSeconds
}

func guardianRegistrationSpec(paths resilience.Paths) startup.RegistrationSpec {
	command := commandLine(resilience.GuardianExecutablePath(paths), []string{
		"--config", paths.ConfigPath,
		"--install-root", paths.InstallRoot,
		"--program-data-root", paths.ProgramDataRoot,
		"--startup",
	})
	return startup.RegistrationSpec{
		StartupName:         "D1GuardianLogon",
		BootStartupName:     "D1GuardianBoot",
		WatchdogStartupName: "D1GuardianWatchdog",
		RunKeyName:          "D1Guardian",
		StartupDescription:  "Starts the d-family guardian when the current user signs in.",
		BootDescription:     "Starts the d-family guardian when Windows boots.",
		WatchdogDescription: "Checks every minute that the d-family guardian is running.",
		Command:             command,
	}
}

func samePath(left string, right string) bool {
	if left == "" || right == "" {
		return false
	}
	return strings.EqualFold(filepath.Clean(strings.TrimSpace(left)), filepath.Clean(strings.TrimSpace(right)))
}

func commandLine(executablePath string, args []string) string {
	all := make([]string, 0, len(args)+1)
	all = append(all, executablePath)
	all = append(all, args...)

	quoted := make([]string, 0, len(all))
	for _, value := range all {
		quoted = append(quoted, `"`+strings.ReplaceAll(value, `"`, `""`)+`"`)
	}
	return strings.Join(quoted, " ")
}

func configureGuardianLogging() {
	log.SetOutput(io.Discard)
}
