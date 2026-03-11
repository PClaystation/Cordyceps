package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/charliearnerstal/jarvis/a1/internal/background"
	"github.com/charliearnerstal/jarvis/a1/internal/commands"
	"github.com/charliearnerstal/jarvis/a1/internal/config"
	"github.com/charliearnerstal/jarvis/a1/internal/instance"
	"github.com/charliearnerstal/jarvis/a1/internal/protocol"
	"github.com/charliearnerstal/jarvis/a1/internal/startup"
	"github.com/charliearnerstal/jarvis/a1/internal/updater"
	"github.com/gorilla/websocket"
)

var (
	defaultVersion        = "0.1.0"
	defaultServerURL      = ""
	defaultBootstrapToken = ""
)

var errRestartRequested = errors.New("agent restart requested")

const startupRefreshInterval = 6 * time.Hour

type enrollRequest struct {
	BootstrapToken    string   `json:"bootstrap_token"`
	DeviceID          string   `json:"device_id,omitempty"`
	DesignationPrefix string   `json:"designation_prefix,omitempty"`
	DisplayName       string   `json:"display_name,omitempty"`
	Version           string   `json:"version"`
	Hostname          string   `json:"hostname"`
	Username          string   `json:"username"`
	Capabilities      []string `json:"capabilities"`
}

type enrollResponse struct {
	OK          bool   `json:"ok"`
	DeviceID    string `json:"device_id"`
	DeviceToken string `json:"device_token"`
	WSURL       string `json:"ws_url"`
	Message     string `json:"message"`
}

func main() {
	var (
		serverURLFlag      string
		deviceIDFlag       string
		displayNameFlag    string
		bootstrapTokenFlag string
		versionFlag        string
		configPathFlag     string
		enrollOnlyFlag     bool
		foregroundFlag     bool
		runAgentFlag       bool
	)

	flag.StringVar(&serverURLFlag, "server-url", resolveStringSetting("A1_SERVER_URL", defaultServerURL), "Server base URL (e.g. https://jarvis.example)")
	flag.StringVar(&deviceIDFlag, "device-id", "", "Device ID (e.g. a1)")
	flag.StringVar(&displayNameFlag, "display-name", strings.TrimSpace(os.Getenv("A1_DISPLAY_NAME")), "Shared display name shown by remotes for this device")
	flag.StringVar(&bootstrapTokenFlag, "bootstrap-token", resolveStringSetting("A1_BOOTSTRAP_TOKEN", defaultBootstrapToken), "Bootstrap token for first-run enrollment")
	flag.StringVar(&versionFlag, "version", defaultVersion, "Agent version string")
	flag.StringVar(&configPathFlag, "config", "", "Path to agent config file")
	flag.BoolVar(&enrollOnlyFlag, "enroll-only", false, "Enroll and exit")
	flag.BoolVar(&foregroundFlag, "foreground", false, "Run in the current console instead of background mode (Windows)")
	flag.BoolVar(&runAgentFlag, "run-agent", false, "Internal flag used for detached relaunch")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.LUTC)
	configureLogging(foregroundFlag, enrollOnlyFlag)

	executablePath, execPathErr := os.Executable()
	if execPathErr != nil {
		log.Printf("warning: resolve executable path failed: %v", execPathErr)
	} else {
		if installed, err := installAndRelaunchIfNeeded(executablePath, os.Args[1:], foregroundFlag, runAgentFlag, enrollOnlyFlag); err != nil {
			log.Printf("warning: self-install failed; continuing in current location: %v", err)
		} else if installed {
			return
		}

		if shouldRelaunchDetached(foregroundFlag, runAgentFlag, enrollOnlyFlag) {
			args := relaunchArgs(os.Args[1:])
			if err := background.RelaunchDetached(executablePath, args); err != nil {
				log.Printf("warning: detached relaunch failed; continuing in foreground: %v", err)
			} else {
				return
			}
		}
	}

	cfgPath := strings.TrimSpace(configPathFlag)
	if cfgPath == "" {
		var err error
		cfgPath, err = config.DefaultConfigPath()
		if err != nil {
			log.Fatalf("resolve config path: %v", err)
		}
	}

	instanceLock, err := instance.Acquire(cfgPath)
	if err != nil {
		if errors.Is(err, instance.ErrAlreadyRunning) {
			log.Printf("agent already running for config %s", cfgPath)
			return
		}
		log.Fatalf("acquire instance lock: %v", err)
	}
	defer func() {
		if releaseErr := instanceLock.Release(); releaseErr != nil {
			log.Printf("warning: release instance lock failed: %v", releaseErr)
		}
	}()

	cfg, err := config.Load(cfgPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Fatalf("load config: %v", err)
		}

		cfg, err = firstRunEnroll(cfgPath, strings.TrimSpace(serverURLFlag), strings.TrimSpace(deviceIDFlag), strings.TrimSpace(displayNameFlag), strings.TrimSpace(bootstrapTokenFlag), strings.TrimSpace(versionFlag))
		if err != nil {
			log.Fatalf("first-run enrollment failed: %v", err)
		}
		log.Printf("enrollment complete for device %s", cfg.DeviceID)
	}

	if strings.TrimSpace(serverURLFlag) != "" {
		cfg.ServerBaseURL = normalizeBaseURL(serverURLFlag)
	}

	if strings.TrimSpace(versionFlag) != "" {
		cfg.Version = strings.TrimSpace(versionFlag)
	}

	if cfg.HeartbeatSeconds <= 0 {
		cfg.HeartbeatSeconds = 60
	}

	if cfg.WSURL == "" {
		wsURL, err := deriveWSURL(cfg.ServerBaseURL)
		if err != nil {
			log.Fatalf("derive websocket URL: %v", err)
		}
		cfg.WSURL = wsURL
	}

	if err := config.Save(cfgPath, cfg); err != nil {
		log.Fatalf("persist config: %v", err)
	}

	if execPathErr == nil {
		if startupErr := startup.EnsureStartupRegistration(executablePath); startupErr != nil {
			log.Printf("warning: startup registration failed: %v", startupErr)
		}
	}

	if enrollOnlyFlag {
		return
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if execPathErr == nil {
		go maintainStartupRegistration(ctx, executablePath)
	}

	runLoop(ctx, cfg, cfgPath)
}

func firstRunEnroll(cfgPath string, serverBaseURL string, deviceIDInput string, displayNameInput string, bootstrapToken string, version string) (*config.Config, error) {
	if serverBaseURL == "" {
		return nil, errors.New("missing server URL; pass --server-url or set A1_SERVER_URL")
	}

	if bootstrapToken == "" {
		return nil, errors.New("missing bootstrap token; pass --bootstrap-token or set A1_BOOTSTRAP_TOKEN")
	}

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

	deviceID := config.SanitizeDeviceID(deviceIDInput)
	autoDesignate := strings.TrimSpace(deviceIDInput) == ""
	if autoDesignate {
		deviceID = ""
	} else if !strings.HasPrefix(deviceID, "a") {
		deviceID = config.SanitizeDeviceID("a-" + deviceID)
	}

	base := normalizeBaseURL(serverBaseURL)

	displayName := strings.TrimSpace(displayNameInput)
	if displayName == "" {
		if autoDesignate {
			displayName = "a-agent"
		} else {
			displayName = deviceID
		}
	}

	requestPayload := enrollRequest{
		BootstrapToken:    bootstrapToken,
		DeviceID:          deviceID,
		DesignationPrefix: "a",
		DisplayName:       displayName,
		Version:           version,
		Hostname:          hostname,
		Username:          username,
		Capabilities:      commands.Capabilities(),
	}

	payload, err := json.Marshal(requestPayload)
	if err != nil {
		return nil, fmt.Errorf("serialize enroll request: %w", err)
	}

	request, err := http.NewRequest(http.MethodPost, base+"/api/enroll", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build enroll request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 20 * time.Second,
	}

	resp, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("send enroll request: %w", err)
	}
	defer resp.Body.Close()

	var enrollResp enrollResponse
	if err := json.NewDecoder(resp.Body).Decode(&enrollResp); err != nil {
		return nil, fmt.Errorf("parse enroll response: %w", err)
	}

	if resp.StatusCode >= 300 || !enrollResp.OK {
		if enrollResp.Message == "" {
			enrollResp.Message = resp.Status
		}
		return nil, fmt.Errorf("enrollment rejected: %s", enrollResp.Message)
	}

	enrolledDeviceID := strings.TrimSpace(enrollResp.DeviceID)
	if enrolledDeviceID == "" {
		enrolledDeviceID = deviceID
	}
	enrolledDeviceID = config.SanitizeDeviceID(enrolledDeviceID)

	deviceToken := strings.TrimSpace(enrollResp.DeviceToken)
	if deviceToken == "" {
		return nil, errors.New("enrollment response missing device_token")
	}

	wsURL := strings.TrimSpace(enrollResp.WSURL)
	if wsURL == "" {
		wsURL, err = deriveWSURL(base)
		if err != nil {
			return nil, fmt.Errorf("derive websocket URL: %w", err)
		}
	}

	cfg := &config.Config{
		DeviceID:         enrolledDeviceID,
		DeviceToken:      deviceToken,
		ServerBaseURL:    base,
		WSURL:            wsURL,
		HeartbeatSeconds: 60,
		Version:          version,
	}

	if err := config.Save(cfgPath, cfg); err != nil {
		return nil, fmt.Errorf("save enrolled config: %w", err)
	}

	return cfg, nil
}

func runLoop(ctx context.Context, cfg *config.Config, cfgPath string) {
	backoff := 2 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := safeRunSession(ctx, cfg, cfgPath)
		if err == nil {
			return
		}

		if errors.Is(err, errRestartRequested) {
			return
		}

		log.Printf("session ended: %v", err)

		jitter := time.Duration(time.Now().UnixNano()%500) * time.Millisecond
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff + jitter):
		}

		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func runSession(ctx context.Context, cfg *config.Config, cfgPath string) error {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(cfg.WSURL, nil)
	if err != nil {
		return fmt.Errorf("connect websocket: %w", err)
	}
	defer conn.Close()
	conn.SetReadLimit(65_536)

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

	hello := protocol.HelloMessage{
		Kind:         "hello",
		DeviceID:     cfg.DeviceID,
		Token:        cfg.DeviceToken,
		Version:      cfg.Version,
		Hostname:     hostname,
		Username:     username,
		Capabilities: commands.Capabilities(),
	}

	conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
	if err := conn.WriteJSON(hello); err != nil {
		return fmt.Errorf("send hello: %w", err)
	}

	log.Printf("connected to %s as %s", cfg.WSURL, cfg.DeviceID)

	var writeMu sync.Mutex
	sendJSON := func(message any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
		return conn.WriteJSON(message)
	}

	heartbeatTicker := time.NewTicker(time.Duration(cfg.HeartbeatSeconds) * time.Second)
	defer heartbeatTicker.Stop()

	errorCh := make(chan error, 2)
	sendError := func(err error) {
		select {
		case errorCh <- err:
		default:
		}
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				sendError(nil)
				return
			case <-heartbeatTicker.C:
				hb := protocol.HeartbeatMessage{
					Kind:     "heartbeat",
					DeviceID: cfg.DeviceID,
					SentAt:   time.Now().UTC().Format(time.RFC3339),
				}

				if err := sendJSON(hb); err != nil {
					sendError(fmt.Errorf("send heartbeat: %w", err))
					return
				}
			}
		}
	}()

	go func() {
		for {
			conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
			_, payload, err := conn.ReadMessage()
			if err != nil {
				sendError(fmt.Errorf("read message: %w", err))
				return
			}

			var base map[string]any
			if err := json.Unmarshal(payload, &base); err != nil {
				log.Printf("invalid json from server: %v", err)
				continue
			}

			kind, _ := base["kind"].(string)
			switch strings.ToLower(kind) {
			case "command":
				var command protocol.CommandEnvelope
				if err := json.Unmarshal(payload, &command); err != nil {
					log.Printf("invalid command envelope: %v", err)
					continue
				}

				if strings.TrimSpace(command.DeviceID) != cfg.DeviceID {
					result := protocol.ResultMessage{
						Kind:        "result",
						RequestID:   command.RequestID,
						DeviceID:    cfg.DeviceID,
						OK:          false,
						Message:     "device_id mismatch",
						ErrorCode:   "DEVICE_MISMATCH",
						CompletedAt: time.Now().UTC().Format(time.RFC3339),
						Version:     cfg.Version,
					}
					_ = sendJSON(result)
					continue
				}

				if strings.EqualFold(strings.TrimSpace(command.Type), "AGENT_UPDATE") {
					updateResult, restartRequired := executeUpdateCommand(cfg, cfgPath, command)
					if err := sendJSON(updateResult); err != nil {
						if restartRequired {
							sendError(errRestartRequested)
							return
						}

						sendError(fmt.Errorf("send result: %w", err))
						return
					}

					if restartRequired {
						sendError(errRestartRequested)
						return
					}

					continue
				}

				result := commands.Execute(cfg.DeviceID, cfg.Version, command)
				if err := sendJSON(result); err != nil {
					sendError(fmt.Errorf("send result: %w", err))
					return
				}
			case "hello_ack", "heartbeat_ack":
				continue
			default:
				log.Printf("unknown message kind from server: %s", kind)
			}
		}
	}()

	select {
	case <-ctx.Done():
		return nil
	case err := <-errorCh:
		return err
	}
}

func executeUpdateCommand(cfg *config.Config, cfgPath string, command protocol.CommandEnvelope) (protocol.ResultMessage, bool) {
	result := protocol.ResultMessage{
		Kind:        "result",
		RequestID:   command.RequestID,
		DeviceID:    cfg.DeviceID,
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
		Version:     cfg.Version,
	}

	executablePath, err := os.Executable()
	if err != nil {
		result.OK = false
		result.ErrorCode = "UPDATE_FAILED"
		result.Message = fmt.Sprintf("resolve executable path: %v", err)
		return result, false
	}

	applyResult, err := updater.Apply(command.Args, executablePath, cfgPath)
	if err != nil {
		result.OK = false
		result.ErrorCode = "UPDATE_FAILED"
		result.Message = err.Error()
		result.Version = cfg.Version
		return result, false
	}

	result.OK = true
	result.Message = applyResult.Message
	result.Version = cfg.Version
	return result, applyResult.RestartRequired
}

func normalizeBaseURL(input string) string {
	trimmed := strings.TrimSpace(input)
	trimmed = strings.TrimSuffix(trimmed, "/")
	return trimmed
}

func deriveWSURL(serverBaseURL string) (string, error) {
	parsed, err := url.Parse(normalizeBaseURL(serverBaseURL))
	if err != nil {
		return "", fmt.Errorf("parse server base URL: %w", err)
	}

	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	case "wss", "ws":
		// keep as-is
	default:
		return "", fmt.Errorf("unsupported server URL scheme: %s", parsed.Scheme)
	}

	parsed.Path = "/ws/agent"
	parsed.RawQuery = ""
	parsed.Fragment = ""

	return parsed.String(), nil
}

func safeRunSession(ctx context.Context, cfg *config.Config, cfgPath string) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("session panic recovered: %v", recovered)
		}
	}()

	return runSession(ctx, cfg, cfgPath)
}

func resolveStringSetting(envKey string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}

	return strings.TrimSpace(fallback)
}

func shouldRelaunchDetached(foreground bool, runAgent bool, enrollOnly bool) bool {
	if runtime.GOOS != "windows" {
		return false
	}

	return !foreground && !runAgent && !enrollOnly
}

func installAndRelaunchIfNeeded(executablePath string, args []string, foreground bool, runAgent bool, enrollOnly bool) (bool, error) {
	if runtime.GOOS != "windows" || foreground || runAgent || enrollOnly {
		return false, nil
	}

	installedPath, err := defaultInstalledExePath()
	if err != nil {
		return false, err
	}

	if sameWindowsPath(executablePath, installedPath) {
		return false, nil
	}

	if err := copyExecutable(executablePath, installedPath); err != nil {
		return false, err
	}

	relaunchPathArgs := relaunchArgs(args)
	if err := background.RelaunchAfterParentExit(installedPath, relaunchPathArgs); err != nil {
		return false, fmt.Errorf("launch installed agent: %w", err)
	}

	return true, nil
}

func defaultInstalledExePath() (string, error) {
	localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if localAppData == "" {
		return "", errors.New("LOCALAPPDATA is not set")
	}

	return filepath.Join(localAppData, "A1Agent", "a1-agent.exe"), nil
}

func sameWindowsPath(left string, right string) bool {
	leftClean := strings.ToLower(filepath.Clean(strings.TrimSpace(left)))
	rightClean := strings.ToLower(filepath.Clean(strings.TrimSpace(right)))
	return leftClean == rightClean
}

func copyExecutable(sourcePath string, destinationPath string) error {
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o700); err != nil {
		return fmt.Errorf("create install dir: %w", err)
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open source executable: %w", err)
	}
	defer sourceFile.Close()

	tempPath := destinationPath + ".tmp"
	destinationFile, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return fmt.Errorf("create installed executable: %w", err)
	}

	if _, err := io.Copy(destinationFile, sourceFile); err != nil {
		_ = destinationFile.Close()
		_ = os.Remove(tempPath)
		return fmt.Errorf("copy executable: %w", err)
	}

	if err := destinationFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close installed executable: %w", err)
	}

	_ = os.Remove(destinationPath)
	if err := os.Rename(tempPath, destinationPath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("activate installed executable: %w", err)
	}

	return nil
}

func relaunchArgs(args []string) []string {
	filtered := make([]string, 0, len(args)+1)
	for _, arg := range args {
		if isFlag(arg, "foreground") || isFlag(arg, "run-agent") {
			continue
		}
		filtered = append(filtered, arg)
	}

	filtered = append(filtered, "--run-agent")
	return filtered
}

func isFlag(arg string, name string) bool {
	trimmed := strings.TrimSpace(arg)
	if trimmed == "" {
		return false
	}

	long := "--" + name
	short := "-" + name
	return trimmed == long ||
		trimmed == short ||
		strings.HasPrefix(trimmed, long+"=") ||
		strings.HasPrefix(trimmed, short+"=")
}

func configureLogging(foreground bool, enrollOnly bool) {
	if runtime.GOOS == "windows" && !foreground && !enrollOnly {
		log.SetOutput(io.Discard)
	}
}

func maintainStartupRegistration(ctx context.Context, executablePath string) {
	ticker := time.NewTicker(startupRefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := startup.EnsureStartupRegistration(executablePath); err != nil {
				log.Printf("warning: periodic startup registration failed: %v", err)
			}
		}
	}
}
