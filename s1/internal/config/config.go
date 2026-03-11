package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type Config struct {
	DeviceID         string `json:"device_id"`
	DeviceToken      string `json:"device_token"`
	ServerBaseURL    string `json:"server_base_url"`
	WSURL            string `json:"ws_url"`
	HeartbeatSeconds int    `json:"heartbeat_seconds"`
	Version          string `json:"version"`
}

func DefaultConfigPath() (string, error) {
	override := strings.TrimSpace(os.Getenv("JARVIS_AGENT_CONFIG"))
	if override != "" {
		return override, nil
	}

	if runtime.GOOS == "windows" {
		appData := strings.TrimSpace(os.Getenv("APPDATA"))
		if appData == "" {
			return "", errors.New("APPDATA is not set")
		}

		return filepath.Join(appData, "S1Agent", "config.json"), nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}

	return filepath.Join(homeDir, ".s1-agent", "config.json"), nil
}

func Load(path string) (*Config, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	cfg.DeviceID = SanitizeDeviceID(cfg.DeviceID)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	cfg.ServerBaseURL = strings.TrimSuffix(strings.TrimSpace(cfg.ServerBaseURL), "/")
	cfg.WSURL = strings.TrimSpace(cfg.WSURL)
	cfg.Version = strings.TrimSpace(cfg.Version)

	if cfg.HeartbeatSeconds <= 0 {
		cfg.HeartbeatSeconds = 60
	}

	if cfg.DeviceToken == "" {
		return nil, errors.New("config missing device_token")
	}

	if cfg.ServerBaseURL == "" {
		return nil, errors.New("config missing server_base_url")
	}

	return &cfg, nil
}

func Save(path string, cfg *Config) error {
	cfg.DeviceID = SanitizeDeviceID(cfg.DeviceID)
	cfg.DeviceToken = strings.TrimSpace(cfg.DeviceToken)
	cfg.ServerBaseURL = strings.TrimSuffix(strings.TrimSpace(cfg.ServerBaseURL), "/")
	cfg.WSURL = strings.TrimSpace(cfg.WSURL)
	cfg.Version = strings.TrimSpace(cfg.Version)

	if cfg.HeartbeatSeconds <= 0 {
		cfg.HeartbeatSeconds = 60
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize config: %w", err)
	}

	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, payload, 0o600); err != nil {
		return fmt.Errorf("write temp config: %w", err)
	}

	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("replace config: %w", err)
	}

	return nil
}

func SanitizeDeviceID(input string) string {
	normalized := strings.ToLower(strings.TrimSpace(input))
	normalized = strings.ReplaceAll(normalized, " ", "-")

	builder := strings.Builder{}
	for _, r := range normalized {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			builder.WriteRune(r)
		}
	}

	result := builder.String()
	if len(result) > 32 {
		result = result[:32]
	}

	if len(result) < 2 {
		return "s1"
	}

	return result
}
