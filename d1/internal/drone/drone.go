package drone

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/background"
	"github.com/charliearnerstal/jarvis/d1/internal/config"
	"github.com/charliearnerstal/jarvis/d1/internal/instance"
	"github.com/charliearnerstal/jarvis/d1/internal/protocol"
	"github.com/charliearnerstal/jarvis/d1/internal/resilience"
	"github.com/charliearnerstal/jarvis/d1/internal/startup"
	"github.com/gorilla/websocket"
)

const (
	reconcileBaseInterval   = 4 * time.Second
	reconcileJitterMax      = 2 * time.Second
	startupRefreshPeriod    = 15 * time.Minute
	restoreClaimTTL         = 20 * time.Second
	initialHeartbeatBackoff = 2 * time.Second
	maxHeartbeatBackoff     = 1 * time.Minute
)

var (
	acquireInstanceLock = instance.Acquire
	relaunchDetached    = background.RelaunchDetached
	timeNow             = time.Now
)

type Options struct {
	Role            string
	Version         string
	ConfigPath      string
	InstallRoot     string
	ProgramDataRoot string
	Foreground      bool
}

type trustManifest struct {
	Version       string   `json:"version"`
	UpdatedAt     string   `json:"updated_at"`
	TrustedSHA256 []string `json:"trusted_sha256"`
}

type journalEvent struct {
	Event     string `json:"event"`
	Role      string `json:"role,omitempty"`
	ActorRole string `json:"actor_role,omitempty"`
	Path      string `json:"path,omitempty"`
	Message   string `json:"message,omitempty"`
	At        string `json:"at"`
}

type persistenceMode string

const (
	persistenceFullAll             persistenceMode = "full_all"
	persistenceRunKeyOnly          persistenceMode = "runkey_only"
	persistenceScheduledAll        persistenceMode = "scheduled_all"
	persistenceLogonRunKey         persistenceMode = "logon_runkey"
	persistenceBootRunKey          persistenceMode = "boot_runkey"
	persistenceWatchdogRunKey      persistenceMode = "watchdog_runkey"
	persistenceLogonOnly           persistenceMode = "logon_only"
	persistenceBootOnly            persistenceMode = "boot_only"
	persistenceWatchdogOnly        persistenceMode = "watchdog_only"
	persistenceLogonBoot           persistenceMode = "logon_boot"
	persistenceLogonWatchdog       persistenceMode = "logon_watchdog"
	persistenceBootWatchdog        persistenceMode = "boot_watchdog"
	persistenceLogonBootRunKey     persistenceMode = "logon_boot_runkey"
	persistenceLogonWatchdogRunKey persistenceMode = "logon_watchdog_runkey"
	persistenceBootWatchdogRunKey  persistenceMode = "boot_watchdog_runkey"
)

func Run(opts Options) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	if !opts.Foreground {
		log.SetOutput(io.Discard)
	}

	paths, err := resilience.ResolvePaths(opts.ConfigPath, opts.InstallRoot, opts.ProgramDataRoot)
	if err != nil {
		return fmt.Errorf("resolve drone paths: %w", err)
	}

	role := resilience.NormalizeDroneRole(opts.Role)
	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve drone executable path: %w", err)
	}

	if installed, err := installAndRelaunchIfNeeded(executablePath, paths, role, opts.Foreground); err != nil {
		log.Printf("warning: drone self-install failed; continuing in current location: %v", err)
	} else if installed {
		return nil
	}

	lock, err := instance.Acquire(paths.ConfigPath + "#drone-" + role)
	if err != nil {
		if errors.Is(err, instance.ErrAlreadyRunning) {
			return nil
		}
		return fmt.Errorf("acquire drone instance lock: %w", err)
	}
	defer func() {
		if releaseErr := lock.Release(); releaseErr != nil {
			log.Printf("warning: release drone lock failed: %v", releaseErr)
		}
	}()

	if !droneRoleEnabled(paths, role) {
		if err := disableStartupPersistence(paths, role); err != nil {
			log.Printf("warning: disable drone startup persistence failed: %v", err)
		}
		return nil
	}

	if err := ensureStartupPersistence(executablePath, paths, role); err != nil {
		log.Printf("warning: drone startup persistence failed: %v", err)
	}

	if err := reconcileFleet(paths, role, executablePath, strings.TrimSpace(opts.Version)); err != nil {
		log.Printf("warning: initial drone reconcile failed: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	go superviseDroneHeartbeat(ctx, paths.ConfigPath, role, strings.TrimSpace(opts.Version))

	nextStartupRepair := timeNow().Add(startupRefreshPeriod)

	for {
		delay := nextReconcileDelay(role)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}

		if !droneRoleEnabled(paths, role) {
			if err := disableStartupPersistence(paths, role); err != nil {
				log.Printf("warning: disable drone startup persistence failed: %v", err)
			}
			return nil
		}

		if timeNow().After(nextStartupRepair) {
			if err := repairStartupPersistenceIfMissing(executablePath, paths, role); err != nil {
				log.Printf("warning: drone startup persistence repair failed: %v", err)
			}
			nextStartupRepair = timeNow().Add(startupRefreshPeriod)
		}

		if err := reconcileFleet(paths, role, executablePath, strings.TrimSpace(opts.Version)); err != nil {
			log.Printf("warning: drone reconcile failed: %v", err)
		}
	}
}

func installAndRelaunchIfNeeded(executablePath string, paths resilience.Paths, role string, foreground bool) (bool, error) {
	targetPath := resilience.DroneExecutablePath(paths, role)
	if samePath(executablePath, targetPath) {
		return false, nil
	}

	if err := resilience.CopyExecutable(executablePath, targetPath); err != nil {
		return false, fmt.Errorf("copy drone executable: %w", err)
	}
	for _, backupPath := range resilience.DroneBackupExecutablePaths(paths, role) {
		if err := resilience.CopyExecutable(executablePath, backupPath); err != nil {
			return false, fmt.Errorf("seed drone backup %s: %w", backupPath, err)
		}
	}
	if err := resilience.CopyExecutable(executablePath, resilience.DroneTemplatePath(paths, role)); err != nil {
		return false, fmt.Errorf("seed drone template: %w", err)
	}

	if err := relaunchDetached(targetPath, launchArgs(paths, role, foreground)); err != nil {
		return false, fmt.Errorf("launch installed drone: %w", err)
	}

	return true, nil
}

func reconcileFleet(paths resilience.Paths, selfRole string, selfExecutablePath string, version string) error {
	targetCount := desiredDroneTargetCount(paths)
	trusted, err := loadTrustedHashes(paths, selfExecutablePath, version)
	if err != nil {
		return err
	}
	if err := persistTrustedHashes(paths, trusted, version); err != nil {
		return err
	}

	if err := ensureTemplate(paths, selfRole, selfExecutablePath, trusted, selfRole); err != nil {
		return err
	}
	if err := ensureColdSpare(paths, selfRole, selfExecutablePath, trusted); err != nil {
		return err
	}

	for _, role := range resilience.DroneRolesUpTo(targetCount) {
		if err := ensureDroneRole(paths, selfRole, selfExecutablePath, trusted, role); err != nil {
			return err
		}
	}

	return nil
}

func ensureDroneRole(paths resilience.Paths, selfRole string, selfExecutablePath string, trusted map[string]struct{}, targetRole string) error {
	return withRestoreClaim(paths, targetRole, func() error {
		if err := ensureTemplate(paths, targetRole, selfExecutablePath, trusted, selfRole); err != nil {
			return err
		}

		liveTrusted, err := isTrustedExecutable(paths, resilience.DroneExecutablePath(paths, targetRole), trusted)
		if err != nil {
			return err
		}
		if !liveTrusted {
			sourcePath, err := bestAvailableDroneImage(paths, selfExecutablePath, selfRole, targetRole, trusted)
			if err != nil {
				return err
			}
			if err := resilience.CopyExecutable(sourcePath, resilience.DroneExecutablePath(paths, targetRole)); err != nil {
				return fmt.Errorf("seed drone %s executable: %w", targetRole, err)
			}
			recordEvent(paths, journalEvent{
				Event:     "restore_live",
				Role:      targetRole,
				ActorRole: selfRole,
				Path:      resilience.DroneExecutablePath(paths, targetRole),
				Message:   "restored missing or untrusted live image",
				At:        timeNow().UTC().Format(time.RFC3339),
			})
		}

		for _, backupPath := range resilience.DroneBackupExecutablePaths(paths, targetRole) {
			backupTrusted, err := isTrustedExecutable(paths, backupPath, trusted)
			if err != nil {
				return err
			}
			if backupTrusted {
				continue
			}

			sourcePath, err := bestAvailableDroneImage(paths, selfExecutablePath, selfRole, targetRole, trusted)
			if err != nil {
				return err
			}
			if err := resilience.CopyExecutable(sourcePath, backupPath); err != nil {
				return fmt.Errorf("seed drone %s backup %s: %w", targetRole, backupPath, err)
			}
			recordEvent(paths, journalEvent{
				Event:     "repair_backup",
				Role:      targetRole,
				ActorRole: selfRole,
				Path:      backupPath,
				Message:   "repaired missing or untrusted backup image",
				At:        timeNow().UTC().Format(time.RFC3339),
			})
		}

		running, err := isDroneRunning(paths, targetRole)
		if err != nil {
			return err
		}
		if !running {
			if err := relaunchDetached(resilience.DroneExecutablePath(paths, targetRole), launchArgs(paths, targetRole, false)); err != nil {
				return fmt.Errorf("launch drone %s: %w", targetRole, err)
			}
			recordEvent(paths, journalEvent{
				Event:     "relaunch_process",
				Role:      targetRole,
				ActorRole: selfRole,
				Path:      resilience.DroneExecutablePath(paths, targetRole),
				Message:   "relaunched missing drone process",
				At:        timeNow().UTC().Format(time.RFC3339),
			})
		}

		return nil
	})
}

func ensureTemplate(paths resilience.Paths, targetRole string, selfExecutablePath string, trusted map[string]struct{}, selfRole string) error {
	templateTrusted, err := isTrustedExecutable(paths, resilience.DroneTemplatePath(paths, targetRole), trusted)
	if err != nil {
		return err
	}
	if templateTrusted {
		return nil
	}

	sourcePath, err := bestAvailableDroneImage(paths, selfExecutablePath, selfRole, targetRole, trusted)
	if err != nil {
		return err
	}
	if err := resilience.CopyExecutable(sourcePath, resilience.DroneTemplatePath(paths, targetRole)); err != nil {
		return fmt.Errorf("seed drone %s template: %w", targetRole, err)
	}
	recordEvent(paths, journalEvent{
		Event:     "refresh_template",
		Role:      targetRole,
		ActorRole: selfRole,
		Path:      resilience.DroneTemplatePath(paths, targetRole),
		Message:   "refreshed dedicated template image",
		At:        timeNow().UTC().Format(time.RFC3339),
	})
	return nil
}

func ensureColdSpare(paths resilience.Paths, selfRole string, selfExecutablePath string, trusted map[string]struct{}) error {
	coldTrusted, err := isTrustedExecutable(paths, resilience.DroneColdSparePath(paths), trusted)
	if err != nil {
		return err
	}
	if coldTrusted {
		return nil
	}

	sourcePath, err := bestAvailableDroneImage(paths, selfExecutablePath, selfRole, selfRole, trusted)
	if err != nil {
		return err
	}
	if err := resilience.CopyExecutable(sourcePath, resilience.DroneColdSparePath(paths)); err != nil {
		return fmt.Errorf("seed cold spare: %w", err)
	}
	recordEvent(paths, journalEvent{
		Event:     "refresh_cold_spare",
		Role:      selfRole,
		ActorRole: selfRole,
		Path:      resilience.DroneColdSparePath(paths),
		Message:   "refreshed dormant cold spare image",
		At:        timeNow().UTC().Format(time.RFC3339),
	})
	return nil
}

func bestAvailableDroneImage(paths resilience.Paths, selfExecutablePath string, selfRole string, targetRole string, trusted map[string]struct{}) (string, error) {
	candidates := []string{
		resilience.DroneExecutablePath(paths, targetRole),
		resilience.DroneTemplatePath(paths, targetRole),
		strings.TrimSpace(selfExecutablePath),
		resilience.DroneTemplatePath(paths, selfRole),
		resilience.DroneColdSparePath(paths),
	}
	candidates = append(candidates, resilience.DroneBackupExecutablePaths(paths, targetRole)...)

	for _, role := range resilience.DroneRoles() {
		candidates = append(candidates, resilience.DroneExecutablePath(paths, role))
		candidates = append(candidates, resilience.DroneBackupExecutablePaths(paths, role)...)
		candidates = append(candidates, resilience.DroneTemplatePath(paths, role))
	}

	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		ok, err := isTrustedExecutable(paths, candidate, trusted)
		if err != nil {
			return "", err
		}
		if ok {
			return candidate, nil
		}
	}

	return "", errors.New("no trusted drone image is available")
}

func loadTrustedHashes(paths resilience.Paths, selfExecutablePath string, version string) (map[string]struct{}, error) {
	trusted := make(map[string]struct{})

	for _, manifestPath := range resilience.DroneTrustManifestPaths(paths) {
		payload, err := os.ReadFile(manifestPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, err
		}

		var manifest trustManifest
		if err := json.Unmarshal(payload, &manifest); err != nil {
			continue
		}

		for _, value := range manifest.TrustedSHA256 {
			trimmed := strings.ToLower(strings.TrimSpace(value))
			if trimmed != "" {
				trusted[trimmed] = struct{}{}
			}
		}
	}

	if len(trusted) > 0 {
		return trusted, nil
	}

	bootstrapCandidates := []string{
		strings.TrimSpace(selfExecutablePath),
		resilience.DroneColdSparePath(paths),
	}
	for _, role := range resilience.DroneRoles() {
		bootstrapCandidates = append(bootstrapCandidates, resilience.DroneExecutablePath(paths, role))
		bootstrapCandidates = append(bootstrapCandidates, resilience.DroneBackupExecutablePaths(paths, role)...)
		bootstrapCandidates = append(bootstrapCandidates, resilience.DroneTemplatePath(paths, role))
	}

	for _, candidate := range bootstrapCandidates {
		hashValue, err := executableHash(candidate)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, io.EOF) {
				continue
			}
			continue
		}
		if hashValue != "" {
			trusted[hashValue] = struct{}{}
		}
	}

	if len(trusted) == 0 {
		return nil, fmt.Errorf("no trusted drone hashes available for version %s", version)
	}

	return trusted, nil
}

func persistTrustedHashes(paths resilience.Paths, trusted map[string]struct{}, version string) error {
	values := make([]string, 0, len(trusted))
	for value := range trusted {
		values = append(values, value)
	}
	manifest := trustManifest{
		Version:       strings.TrimSpace(version),
		UpdatedAt:     timeNow().UTC().Format(time.RFC3339),
		TrustedSHA256: values,
	}

	for _, manifestPath := range resilience.DroneTrustManifestPaths(paths) {
		if err := saveJSON(manifestPath, manifest); err != nil {
			return err
		}
	}

	return nil
}

func isTrustedExecutable(_ resilience.Paths, path string, trusted map[string]struct{}) (bool, error) {
	missing, err := resilience.MissingOrInvalidExecutable(path)
	if err != nil {
		return false, err
	}
	if missing {
		return false, nil
	}

	hashValue, err := executableHash(path)
	if err != nil {
		return false, err
	}
	_, ok := trusted[hashValue]
	return ok, nil
}

func executableHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	sum := sha256.New()
	if _, err := io.Copy(sum, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(sum.Sum(nil)), nil
}

func ensureStartupPersistence(executablePath string, paths resilience.Paths, role string) error {
	spec := droneRegistrationSpec(executablePath, paths, role)
	return startup.EnsureRegistrationMode(spec, droneRegistrationMode(role))
}

func repairStartupPersistenceIfMissing(executablePath string, paths resilience.Paths, role string) error {
	spec := droneRegistrationSpec(executablePath, paths, role)
	return startup.RepairRegistrationModeIfMissing(spec, droneRegistrationMode(role))
}

func droneRegistrationSpec(executablePath string, paths resilience.Paths, role string) startup.RegistrationSpec {
	normalizedRole := resilience.NormalizeDroneRole(role)
	command := strings.Join([]string{
		fmt.Sprintf(`"%s"`, executablePath),
		fmt.Sprintf(`--config "%s"`, paths.ConfigPath),
		fmt.Sprintf(`--install-root "%s"`, paths.InstallRoot),
		fmt.Sprintf(`--program-data-root "%s"`, paths.ProgramDataRoot),
		fmt.Sprintf(`--role "%s"`, normalizedRole),
	}, " ")

	return startup.RegistrationSpec{
		StartupName:         "D1Drone" + normalizedRole + "Logon",
		BootStartupName:     "D1Drone" + normalizedRole + "Boot",
		WatchdogStartupName: "D1Drone" + normalizedRole + "Watchdog",
		RunKeyName:          "D1Drone" + normalizedRole,
		StartupDescription:  "Starts D1 restore drone " + normalizedRole + " when the current user signs in.",
		BootDescription:     "Starts D1 restore drone " + normalizedRole + " when Windows boots.",
		WatchdogDescription: "Checks every minute that D1 restore drone " + normalizedRole + " is running.",
		Command:             command,
	}
}

func dronePersistenceMode(role string) persistenceMode {
	switch resilience.DroneRoleKind(role) {
	case resilience.DroneRole2:
		return persistenceRunKeyOnly
	case resilience.DroneRole3:
		return persistenceScheduledAll
	case resilience.DroneRole4:
		return persistenceLogonRunKey
	case resilience.DroneRole5:
		return persistenceBootRunKey
	case resilience.DroneRole6:
		return persistenceWatchdogRunKey
	case resilience.DroneRole7:
		return persistenceLogonOnly
	case resilience.DroneRole8:
		return persistenceBootOnly
	case resilience.DroneRole9:
		return persistenceWatchdogOnly
	case resilience.DroneRole10:
		return persistenceLogonBoot
	case resilience.DroneRole11:
		return persistenceLogonWatchdog
	case resilience.DroneRole12:
		return persistenceBootWatchdog
	case resilience.DroneRole13:
		return persistenceLogonBootRunKey
	case resilience.DroneRole14:
		return persistenceLogonWatchdogRunKey
	case resilience.DroneRole15:
		return persistenceBootWatchdogRunKey
	default:
		return persistenceFullAll
	}
}

func droneRegistrationMode(role string) startup.RegistrationMode {
	switch dronePersistenceMode(role) {
	case persistenceRunKeyOnly:
		return startup.RegistrationMode{RunKey: true}
	case persistenceScheduledAll:
		return startup.RegistrationMode{LogonTask: true, BootTask: true, WatchdogTask: true}
	case persistenceLogonRunKey:
		return startup.RegistrationMode{LogonTask: true, RunKey: true}
	case persistenceBootRunKey:
		return startup.RegistrationMode{BootTask: true, RunKey: true}
	case persistenceWatchdogRunKey:
		return startup.RegistrationMode{WatchdogTask: true, RunKey: true}
	case persistenceLogonOnly:
		return startup.RegistrationMode{LogonTask: true}
	case persistenceBootOnly:
		return startup.RegistrationMode{BootTask: true}
	case persistenceWatchdogOnly:
		return startup.RegistrationMode{WatchdogTask: true}
	case persistenceLogonBoot:
		return startup.RegistrationMode{LogonTask: true, BootTask: true}
	case persistenceLogonWatchdog:
		return startup.RegistrationMode{LogonTask: true, WatchdogTask: true}
	case persistenceBootWatchdog:
		return startup.RegistrationMode{BootTask: true, WatchdogTask: true}
	case persistenceLogonBootRunKey:
		return startup.RegistrationMode{LogonTask: true, BootTask: true, RunKey: true}
	case persistenceLogonWatchdogRunKey:
		return startup.RegistrationMode{LogonTask: true, WatchdogTask: true, RunKey: true}
	case persistenceBootWatchdogRunKey:
		return startup.RegistrationMode{BootTask: true, WatchdogTask: true, RunKey: true}
	default:
		return startup.RegistrationMode{LogonTask: true, BootTask: true, WatchdogTask: true, RunKey: true}
	}
}

func disableStartupPersistence(paths resilience.Paths, role string) error {
	spec := droneRegistrationSpec(resilience.DroneExecutablePath(paths, role), paths, role)
	return startup.DisableRegistration(spec)
}

func desiredDroneTargetCount(paths resilience.Paths) int {
	cfg, err := config.Load(paths.ConfigPath)
	if err != nil {
		return config.NormalizeDroneTargetCount(len(resilience.DroneRoles()))
	}

	return config.NormalizeDroneTargetCount(cfg.DroneTargetCount)
}

func droneRoleWithinTarget(role string, targetCount int) bool {
	return resilience.DroneRoleNumber(role) <= config.NormalizeDroneTargetCount(targetCount)
}

func droneRoleEnabled(paths resilience.Paths, role string) bool {
	return droneRoleWithinTarget(role, desiredDroneTargetCount(paths))
}

func withRestoreClaim(paths resilience.Paths, role string, fn func() error) error {
	claimPath := resilience.DroneRestoreClaimPath(paths, role)
	if err := os.MkdirAll(filepath.Dir(claimPath), 0o700); err != nil {
		return err
	}

	for {
		file, err := os.OpenFile(claimPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			_, _ = file.WriteString(timeNow().UTC().Format(time.RFC3339))
			_ = file.Close()
			defer os.Remove(claimPath)
			return fn()
		}
		if !errors.Is(err, os.ErrExist) {
			return err
		}

		info, statErr := os.Stat(claimPath)
		if statErr == nil && timeNow().Sub(info.ModTime()) > restoreClaimTTL {
			_ = os.Remove(claimPath)
			continue
		}

		return nil
	}
}

func recordEvent(paths resilience.Paths, event journalEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	for _, journalPath := range resilience.DroneEventJournalPaths(paths) {
		if err := os.MkdirAll(filepath.Dir(journalPath), 0o700); err != nil {
			continue
		}
		file, err := os.OpenFile(journalPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			continue
		}
		_, _ = file.Write(append(payload, '\n'))
		_ = file.Close()
	}
}

func superviseDroneHeartbeat(ctx context.Context, cfgPath string, role string, version string) {
	backoff := initialHeartbeatBackoff

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		cfg, err := config.Load(cfgPath)
		if err != nil {
			log.Printf("drone heartbeat config unavailable: %v", err)
			if !waitForHeartbeatRetry(ctx, backoff) {
				return
			}
			backoff = nextHeartbeatBackoff(backoff)
			continue
		}

		if cfg.HeartbeatSeconds <= 0 {
			cfg.HeartbeatSeconds = 60
		}

		if err := runDroneHeartbeatSession(ctx, cfgPath, role, firstNonEmpty(strings.TrimSpace(version), strings.TrimSpace(cfg.Version), "0.1.0")); err != nil {
			log.Printf("drone heartbeat session ended: %v", err)
			if !waitForHeartbeatRetry(ctx, backoff) {
				return
			}
			backoff = nextHeartbeatBackoff(backoff)
			continue
		}

		return
	}
}

func runDroneHeartbeatSession(ctx context.Context, cfgPath string, role string, version string) error {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}

	wsURL, err := deriveHeartbeatWSURL(cfg.ServerBaseURL)
	if err != nil {
		return fmt.Errorf("derive heartbeat websocket URL: %w", err)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}

	conn, resp, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		if resp != nil {
			return fmt.Errorf("dial drone heartbeat websocket: %s", resp.Status)
		}
		return fmt.Errorf("dial drone heartbeat websocket: %w", err)
	}
	defer conn.Close()

	conn.SetReadLimit(16 * 1024)
	extendReadDeadline := func() error {
		return conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
	}
	if err := extendReadDeadline(); err != nil {
		return fmt.Errorf("set initial drone heartbeat read deadline: %w", err)
	}
	conn.SetPingHandler(func(appData string) error {
		if err := extendReadDeadline(); err != nil {
			return err
		}

		return conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(5*time.Second))
	})
	conn.SetPongHandler(func(string) error {
		return extendReadDeadline()
	})

	hostname, username := currentIdentity()
	hello := map[string]any{
		"kind":       "heartbeat_hello",
		"device_id":  cfg.DeviceID,
		"token":      cfg.DeviceToken,
		"version":    version,
		"hostname":   hostname,
		"username":   username,
		"subprocess": "drone",
		"role":       resilience.NormalizeDroneRole(role),
	}

	conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
	if err := conn.WriteJSON(hello); err != nil {
		return fmt.Errorf("send drone heartbeat hello: %w", err)
	}

	readErrCh := make(chan error, 1)
	go func() {
		for {
			if err := extendReadDeadline(); err != nil {
				readErrCh <- err
				return
			}

			_, payload, err := conn.ReadMessage()
			if err != nil {
				readErrCh <- err
				return
			}
			if err := syncDroneTargetCount(cfgPath, payload); err != nil {
				log.Printf("warning: drone target sync failed: %v", err)
			}
		}
	}()

	ticker := time.NewTicker(time.Duration(cfg.HeartbeatSeconds) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(3*time.Second))
			return nil
		case err := <-readErrCh:
			return err
		case <-ticker.C:
			payload := protocol.HeartbeatMessage{
				Kind:     "heartbeat",
				DeviceID: cfg.DeviceID,
				SentAt:   time.Now().UTC().Format(time.RFC3339),
			}
			conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
			if err := conn.WriteJSON(payload); err != nil {
				return fmt.Errorf("send drone heartbeat: %w", err)
			}
		}
	}
}

func syncDroneTargetCount(cfgPath string, payload []byte) error {
	var ack protocol.AckMessage
	if err := json.Unmarshal(payload, &ack); err != nil {
		return err
	}

	if ack.DroneTargetCount <= 0 {
		return nil
	}

	_, err := config.UpdateDroneTargetCount(cfgPath, ack.DroneTargetCount)
	return err
}

func waitForHeartbeatRetry(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextHeartbeatBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > maxHeartbeatBackoff {
		return maxHeartbeatBackoff
	}
	return next
}

func currentIdentity() (string, string) {
	hostname, _ := os.Hostname()
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		hostname = "unknown-host"
	}

	username := strings.TrimSpace(os.Getenv("USERNAME"))
	if username == "" {
		username = strings.TrimSpace(os.Getenv("USER"))
	}
	if username == "" {
		username = "unknown-user"
	}

	return hostname, username
}

func deriveHeartbeatWSURL(baseURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", err
	}

	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	case "wss", "ws":
	default:
		return "", fmt.Errorf("unsupported server URL scheme %q", parsed.Scheme)
	}

	basePath := strings.TrimRight(parsed.Path, "/")
	if basePath == "" {
		parsed.Path = "/ws/device-heartbeat"
	} else {
		parsed.Path = basePath + "/ws/device-heartbeat"
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func saveJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, payload, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

func ensureDroneRunning(paths resilience.Paths, role string) error {
	running, err := isDroneRunning(paths, role)
	if err != nil {
		return err
	}
	if running {
		return nil
	}

	return relaunchDetached(resilience.DroneExecutablePath(paths, role), launchArgs(paths, role, false))
}

func isDroneRunning(paths resilience.Paths, role string) (bool, error) {
	lock, err := acquireInstanceLock(paths.ConfigPath + "#drone-" + resilience.NormalizeDroneRole(role))
	if err != nil {
		if errors.Is(err, instance.ErrAlreadyRunning) {
			return true, nil
		}
		return false, err
	}
	if lock != nil {
		if releaseErr := lock.Release(); releaseErr != nil {
			return false, releaseErr
		}
	}
	return false, nil
}

func launchArgs(paths resilience.Paths, role string, foreground bool) []string {
	args := []string{
		"--config", paths.ConfigPath,
		"--install-root", paths.InstallRoot,
		"--program-data-root", paths.ProgramDataRoot,
		"--role", resilience.NormalizeDroneRole(role),
	}
	if foreground {
		args = append(args, "--foreground")
	}
	return args
}

func nextReconcileDelay(role string) time.Duration {
	index := resilience.DroneRoleNumber(role)
	base := reconcileBaseInterval + time.Duration(index-1)*350*time.Millisecond
	jitter := time.Duration(rand.New(rand.NewSource(timeNow().UnixNano() + int64(index)*97)).Int63n(int64(reconcileJitterMax)))
	return base + jitter
}

func samePath(left string, right string) bool {
	leftClean := filepath.Clean(strings.TrimSpace(left))
	rightClean := filepath.Clean(strings.TrimSpace(right))
	return strings.EqualFold(leftClean, rightClean)
}
