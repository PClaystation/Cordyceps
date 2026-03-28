package resilience

import (
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/config"
)

const (
	SlotA = "a"
	SlotB = "b"

	DroneRole1  = "1"
	DroneRole2  = "2"
	DroneRole3  = "3"
	DroneRole4  = "4"
	DroneRole5  = "5"
	DroneRole6  = "6"
	DroneRole7  = "7"
	DroneRole8  = "8"
	DroneRole9  = "9"
	DroneRole10 = "10"
	DroneRole11 = "11"
	DroneRole12 = "12"
	DroneRole13 = "13"
	DroneRole14 = "14"
	DroneRole15 = "15"
	DroneRole16 = "16"
)

var droneRoles = []string{
	DroneRole1,
	DroneRole2,
	DroneRole3,
	DroneRole4,
	DroneRole5,
	DroneRole6,
	DroneRole7,
	DroneRole8,
	DroneRole9,
	DroneRole10,
	DroneRole11,
	DroneRole12,
	DroneRole13,
	DroneRole14,
	DroneRole15,
	DroneRole16,
}

type Paths struct {
	ConfigPath      string
	InstallRoot     string
	ProgramDataRoot string
}

type State struct {
	ActiveSlot         string          `json:"active_slot"`
	LastHealthySlot    string          `json:"last_healthy_slot,omitempty"`
	LastHealthyVersion string          `json:"last_healthy_version,omitempty"`
	LastHealthyAt      string          `json:"last_healthy_at,omitempty"`
	Pending            *PendingRollout `json:"pending,omitempty"`
}

type PendingRollout struct {
	TargetSlot    string `json:"target_slot"`
	PreviousSlot  string `json:"previous_slot"`
	TargetVersion string `json:"target_version,omitempty"`
	RequestedAt   string `json:"requested_at"`
	Deadline      string `json:"deadline"`
}

type RolloutRequest struct {
	TargetSlot    string `json:"target_slot"`
	PreviousSlot  string `json:"previous_slot"`
	TargetVersion string `json:"target_version,omitempty"`
	RequestedAt   string `json:"requested_at"`
}

type Health struct {
	DeviceID string `json:"device_id,omitempty"`
	Slot     string `json:"slot,omitempty"`
	Version  string `json:"version,omitempty"`
	AckedAt  string `json:"acked_at"`
}

func ResolvePaths(configPath string, installRoot string, programDataRoot string) (Paths, error) {
	resolvedConfig := strings.TrimSpace(configPath)
	if resolvedConfig == "" {
		var err error
		resolvedConfig, err = config.DefaultConfigPath()
		if err != nil {
			return Paths{}, err
		}
	}

	resolvedInstallRoot := strings.TrimSpace(installRoot)
	if resolvedInstallRoot == "" {
		var err error
		resolvedInstallRoot, err = DefaultInstallRoot()
		if err != nil {
			return Paths{}, err
		}
	}

	resolvedProgramDataRoot := strings.TrimSpace(programDataRoot)
	if resolvedProgramDataRoot == "" {
		var err error
		resolvedProgramDataRoot, err = DefaultProgramDataRoot()
		if err != nil {
			return Paths{}, err
		}
	}

	return Paths{
		ConfigPath:      filepath.Clean(resolvedConfig),
		InstallRoot:     filepath.Clean(resolvedInstallRoot),
		ProgramDataRoot: filepath.Clean(resolvedProgramDataRoot),
	}, nil
}

func DefaultInstallRoot() (string, error) {
	if runtime.GOOS == "windows" {
		localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
		if localAppData == "" {
			return "", errors.New("LOCALAPPDATA is not set")
		}
		return filepath.Join(localAppData, "D1Agent"), nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(homeDir, ".d1-agent"), nil
}

func DefaultProgramDataRoot() (string, error) {
	if runtime.GOOS == "windows" {
		programData := strings.TrimSpace(os.Getenv("PROGRAMDATA"))
		if programData == "" {
			return "", errors.New("PROGRAMDATA is not set")
		}
		return filepath.Join(programData, "CordycepsD1"), nil
	}

	return DefaultInstallRoot()
}

func SlotExecutablePath(paths Paths, slot string) string {
	return filepath.Join(paths.InstallRoot, "slots", "slot-"+NormalizeSlot(slot), "d1-agent.exe")
}

func LegacyAgentPath(paths Paths) string {
	return filepath.Join(paths.InstallRoot, "d1-agent.exe")
}

func GuardianExecutablePath(paths Paths) string {
	return filepath.Join(paths.ProgramDataRoot, "d1-guardian.exe")
}

func HeartbeatExecutablePath(paths Paths) string {
	return filepath.Join(paths.ProgramDataRoot, "d1-heartbeat.exe")
}

func DroneExecutablePath(paths Paths, role string) string {
	return filepath.Join(droneLiveRoot(paths, role), "d1-drone-"+NormalizeDroneRole(role)+".exe")
}

func DroneBackupExecutablePath(paths Paths, role string) string {
	return DroneBackupExecutablePaths(paths, role)[0]
}

func DroneBackupExecutablePaths(paths Paths, role string) []string {
	normalizedRole := NormalizeDroneRole(role)
	name := "d1-drone-" + normalizedRole + ".exe"
	candidates := []string{
		filepath.Join(droneBackupRoot(paths, role), name),
		filepath.Join(droneBackupMirrorRoot(paths, role), name),
	}

	seen := make(map[string]struct{}, len(candidates))
	deduped := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		key := strings.ToLower(filepath.Clean(candidate))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, candidate)
	}

	return deduped
}

func DroneTemplatePath(paths Paths, role string) string {
	return filepath.Join(paths.ProgramDataRoot, "templates", "mesh-"+NormalizeDroneRole(role), "d1-drone-"+NormalizeDroneRole(role)+".exe")
}

func DroneColdSparePath(paths Paths) string {
	return filepath.Join(paths.InstallRoot, "fonts", "cache", "cold-spare", "d1-drone-cold.exe")
}

func DroneTrustManifestPaths(paths Paths) []string {
	configRoot := filepath.Dir(paths.ConfigPath)
	return []string{
		filepath.Join(paths.ProgramDataRoot, "manifests", "drone-trust.json"),
		filepath.Join(paths.InstallRoot, "cache", "drone-trust.json"),
		filepath.Join(configRoot, "manifests", "drone-trust.json"),
	}
}

func DroneRolloutPolicyPaths(paths Paths) []string {
	configRoot := filepath.Dir(paths.ConfigPath)
	return []string{
		filepath.Join(paths.ProgramDataRoot, "manifests", "drone-rollout.json"),
		filepath.Join(paths.InstallRoot, "cache", "drone-rollout.json"),
		filepath.Join(configRoot, "manifests", "drone-rollout.json"),
	}
}

func DroneEventJournalPaths(paths Paths) []string {
	configRoot := filepath.Dir(paths.ConfigPath)
	return []string{
		filepath.Join(paths.ProgramDataRoot, "events", "drone-events.ndjson"),
		filepath.Join(configRoot, "events", "drone-events.ndjson"),
	}
}

func DroneRestoreClaimPath(paths Paths, role string) string {
	return DroneRestoreClaimPaths(paths, role)[0]
}

func DroneRestoreClaimPaths(paths Paths, role string) []string {
	configRoot := filepath.Dir(paths.ConfigPath)
	name := "drone-" + NormalizeDroneRole(role) + ".claim"
	return []string{
		filepath.Join(paths.ProgramDataRoot, "claims", name),
		filepath.Join(configRoot, "claims", name),
	}
}

func DroneHeartbeatPaths(paths Paths, role string) []string {
	configRoot := filepath.Dir(paths.ConfigPath)
	name := "drone-" + NormalizeDroneRole(role) + ".json"
	return []string{
		filepath.Join(paths.ProgramDataRoot, "leases", name),
		filepath.Join(configRoot, "leases", name),
	}
}

func DroneLockScope(role string) string {
	return "machine-scope/drone/" + NormalizeDroneRole(role)
}

func FallbackAgentPath(paths Paths) string {
	return filepath.Join(paths.ProgramDataRoot, "fallback", "d1-agent.exe")
}

func StatePath(paths Paths) string {
	return filepath.Join(paths.ProgramDataRoot, "guardian-state.json")
}

func RolloutRequestPath(paths Paths) string {
	return filepath.Join(paths.ProgramDataRoot, "rollout-request.json")
}

func HealthPath(paths Paths) string {
	return filepath.Join(paths.ProgramDataRoot, "agent-health.json")
}

func DefaultState() *State {
	return &State{ActiveSlot: SlotA}
}

func LoadState(paths Paths) (*State, error) {
	return loadJSON(StatePath(paths), DefaultState())
}

func SaveState(paths Paths, state *State) error {
	if state == nil {
		state = DefaultState()
	}
	state.ActiveSlot = NormalizeSlot(state.ActiveSlot)
	if state.Pending != nil {
		state.Pending.TargetSlot = NormalizeSlot(state.Pending.TargetSlot)
		state.Pending.PreviousSlot = NormalizeSlot(state.Pending.PreviousSlot)
	}
	return saveJSON(StatePath(paths), state)
}

func LoadRolloutRequest(paths Paths) (*RolloutRequest, error) {
	return loadJSON(RolloutRequestPath(paths), (*RolloutRequest)(nil))
}

func SaveRolloutRequest(paths Paths, request *RolloutRequest) error {
	if request == nil {
		return errors.New("nil rollout request")
	}
	request.TargetSlot = NormalizeSlot(request.TargetSlot)
	request.PreviousSlot = NormalizeSlot(request.PreviousSlot)
	return saveJSON(RolloutRequestPath(paths), request)
}

func DeleteRolloutRequest(paths Paths) error {
	if err := os.Remove(RolloutRequestPath(paths)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func LoadHealth(paths Paths) (*Health, error) {
	return loadJSON(HealthPath(paths), (*Health)(nil))
}

func SaveHealth(paths Paths, health *Health) error {
	if health == nil {
		return errors.New("nil health payload")
	}
	health.Slot = NormalizeSlot(health.Slot)
	return saveJSON(HealthPath(paths), health)
}

func NormalizeSlot(slot string) string {
	switch strings.ToLower(strings.TrimSpace(slot)) {
	case SlotB:
		return SlotB
	default:
		return SlotA
	}
}

func OtherSlot(slot string) string {
	if NormalizeSlot(slot) == SlotA {
		return SlotB
	}
	return SlotA
}

func NormalizeDroneRole(role string) string {
	return strconv.Itoa(DroneRoleNumber(role))
}

func DroneRoleNumber(role string) int {
	value, err := strconv.Atoi(strings.TrimSpace(role))
	if err != nil || value < 1 {
		return 1
	}
	return value
}

func DroneRoleKind(role string) string {
	return strconv.Itoa(droneRoleBucket(role))
}

func DroneRoles() []string {
	return append([]string(nil), droneRoles...)
}

func DroneRolesUpTo(targetCount int) []string {
	normalizedCount := config.NormalizeDroneTargetCount(targetCount)
	roles := make([]string, 0, normalizedCount)
	for role := 1; role <= normalizedCount; role++ {
		roles = append(roles, strconv.Itoa(role))
	}
	return roles
}

func droneRoleBucket(role string) int {
	roleNumber := DroneRoleNumber(role)
	if roleNumber <= len(droneRoles) {
		return roleNumber
	}

	// Overflow roles keep their own numeric identity but get assigned one
	// canonical role kind in a stable pseudo-random way so roots and
	// persistence modes do not churn across reconciles.
	hashValue := fnv.New32a()
	_, _ = hashValue.Write([]byte(strconv.Itoa(roleNumber)))
	return int(hashValue.Sum32()%uint32(len(droneRoles))) + 1
}

func droneLiveRoot(paths Paths, role string) string {
	configRoot := filepath.Dir(paths.ConfigPath)
	normalizedRole := NormalizeDroneRole(role)

	switch droneRoleBucket(role) {
	case 2:
		return filepath.Join(paths.InstallRoot, "support", "mesh-"+normalizedRole)
	case 3:
		return filepath.Join(configRoot, "drivers", "mesh-"+normalizedRole)
	case 4:
		return filepath.Join(paths.ProgramDataRoot, "broker", "mesh-"+normalizedRole)
	case 5:
		return filepath.Join(paths.InstallRoot, "cache", "mesh-"+normalizedRole)
	case 6:
		return filepath.Join(configRoot, "spool", "mesh-"+normalizedRole)
	case 7:
		return filepath.Join(paths.ProgramDataRoot, "catalog", "mesh-"+normalizedRole)
	case 8:
		return filepath.Join(paths.InstallRoot, "telemetry", "mesh-"+normalizedRole)
	case 9:
		return filepath.Join(configRoot, "profiles", "mesh-"+normalizedRole)
	case 10:
		return filepath.Join(paths.ProgramDataRoot, "runtime", "mesh-"+normalizedRole)
	case 11:
		return filepath.Join(paths.InstallRoot, "packages", "mesh-"+normalizedRole)
	case 12:
		return filepath.Join(configRoot, "plugins", "mesh-"+normalizedRole)
	case 13:
		return filepath.Join(paths.ProgramDataRoot, "inventory", "mesh-"+normalizedRole)
	case 14:
		return filepath.Join(paths.InstallRoot, "themes", "mesh-"+normalizedRole)
	case 15:
		return filepath.Join(configRoot, "modules", "mesh-"+normalizedRole)
	case 16:
		return filepath.Join(paths.ProgramDataRoot, "archive", "mesh-"+normalizedRole)
	default:
		return filepath.Join(paths.ProgramDataRoot, "svc-cache", "mesh-"+normalizedRole)
	}
}

func droneBackupRoot(paths Paths, role string) string {
	configRoot := filepath.Dir(paths.ConfigPath)
	normalizedRole := NormalizeDroneRole(role)

	switch droneRoleBucket(role) {
	case 2:
		return filepath.Join(paths.ProgramDataRoot, "spool", "mesh-"+normalizedRole+"-backup")
	case 3:
		return filepath.Join(paths.InstallRoot, "backup", "mesh-"+normalizedRole+"-backup")
	case 4:
		return filepath.Join(configRoot, "backup", "mesh-"+normalizedRole+"-backup")
	case 5:
		return filepath.Join(paths.ProgramDataRoot, "backup", "mesh-"+normalizedRole+"-backup")
	case 6:
		return filepath.Join(paths.InstallRoot, "journals", "mesh-"+normalizedRole+"-backup")
	case 7:
		return filepath.Join(configRoot, "telemetry", "mesh-"+normalizedRole+"-backup")
	case 8:
		return filepath.Join(paths.ProgramDataRoot, "staging", "mesh-"+normalizedRole+"-backup")
	case 9:
		return filepath.Join(paths.ProgramDataRoot, "shadow", "mesh-"+normalizedRole+"-backup")
	case 10:
		return filepath.Join(paths.InstallRoot, "restore", "mesh-"+normalizedRole+"-backup")
	case 11:
		return filepath.Join(configRoot, "vault", "mesh-"+normalizedRole+"-backup")
	case 12:
		return filepath.Join(paths.ProgramDataRoot, "quarantine", "mesh-"+normalizedRole+"-backup")
	case 13:
		return filepath.Join(paths.InstallRoot, "manifests", "mesh-"+normalizedRole+"-backup")
	case 14:
		return filepath.Join(configRoot, "snapshots", "mesh-"+normalizedRole+"-backup")
	case 15:
		return filepath.Join(paths.ProgramDataRoot, "indices", "mesh-"+normalizedRole+"-backup")
	case 16:
		return filepath.Join(paths.InstallRoot, "coldstore", "mesh-"+normalizedRole+"-backup")
	default:
		return filepath.Join(configRoot, "cache", "mesh-"+normalizedRole+"-backup")
	}
}

func droneBackupMirrorRoot(paths Paths, role string) string {
	configRoot := filepath.Dir(paths.ConfigPath)
	normalizedRole := NormalizeDroneRole(role)

	switch droneRoleBucket(role) {
	case 2:
		return filepath.Join(configRoot, "relay", "mesh-"+normalizedRole+"-backup")
	case 3:
		return filepath.Join(paths.ProgramDataRoot, "relay", "mesh-"+normalizedRole+"-backup")
	case 4:
		return filepath.Join(paths.InstallRoot, "quarantine", "mesh-"+normalizedRole+"-backup")
	case 5:
		return filepath.Join(configRoot, "ledger", "mesh-"+normalizedRole+"-backup")
	case 6:
		return filepath.Join(paths.ProgramDataRoot, "journals", "mesh-"+normalizedRole+"-backup")
	case 7:
		return filepath.Join(paths.InstallRoot, "mirrors", "mesh-"+normalizedRole+"-backup")
	case 8:
		return filepath.Join(configRoot, "staging", "mesh-"+normalizedRole+"-backup")
	case 9:
		return filepath.Join(paths.InstallRoot, "vault", "mesh-"+normalizedRole+"-backup")
	case 10:
		return filepath.Join(configRoot, "restore", "mesh-"+normalizedRole+"-backup")
	case 11:
		return filepath.Join(paths.ProgramDataRoot, "packages", "mesh-"+normalizedRole+"-backup")
	case 12:
		return filepath.Join(paths.InstallRoot, "plugins", "mesh-"+normalizedRole+"-backup")
	case 13:
		return filepath.Join(configRoot, "inventory", "mesh-"+normalizedRole+"-backup")
	case 14:
		return filepath.Join(paths.ProgramDataRoot, "themes", "mesh-"+normalizedRole+"-backup")
	case 15:
		return filepath.Join(paths.InstallRoot, "modules", "mesh-"+normalizedRole+"-backup")
	case 16:
		return filepath.Join(configRoot, "archive", "mesh-"+normalizedRole+"-backup")
	default:
		return filepath.Join(paths.InstallRoot, "shadow-cache", "mesh-"+normalizedRole+"-backup")
	}
}

func InferSlotFromExecutable(executablePath string, paths Paths) string {
	trimmed := strings.TrimSpace(executablePath)
	if trimmed == "" {
		return SlotA
	}

	cleaned := filepath.Clean(trimmed)
	if samePath(cleaned, SlotExecutablePath(paths, SlotB)) {
		return SlotB
	}
	if samePath(cleaned, SlotExecutablePath(paths, SlotA)) {
		return SlotA
	}
	return SlotA
}

func ParseTimestamp(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func samePath(left string, right string) bool {
	leftClean := filepath.Clean(strings.TrimSpace(left))
	rightClean := filepath.Clean(strings.TrimSpace(right))
	if runtime.GOOS == "windows" {
		return strings.EqualFold(leftClean, rightClean)
	}
	return leftClean == rightClean
}

func loadJSON[T any](path string, fallback T) (T, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fallback, nil
		}
		var zero T
		return zero, err
	}

	var value T
	if err := json.Unmarshal(payload, &value); err != nil {
		var zero T
		return zero, err
	}
	return value, nil
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

func CopyExecutable(sourcePath string, destinationPath string) error {
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o700); err != nil {
		return err
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	tempPath := destinationPath + ".tmp"
	destinationFile, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return err
	}

	if _, err := io.Copy(destinationFile, sourceFile); err != nil {
		_ = destinationFile.Close()
		_ = os.Remove(tempPath)
		return err
	}

	if err := destinationFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	_ = os.Remove(destinationPath)
	if err := os.Rename(tempPath, destinationPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	return nil
}

func MissingOrInvalidExecutable(path string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return true, nil
		}
		return false, err
	}
	defer file.Close()

	header := make([]byte, 2)
	if _, err := io.ReadFull(file, header); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return true, nil
		}
		return false, err
	}

	return header[0] != 'M' || header[1] != 'Z', nil
}
