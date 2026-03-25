package resilience

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/config"
)

const (
	SlotA = "a"
	SlotB = "b"
)

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
