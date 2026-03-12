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

	"github.com/charliearnerstal/jarvis/s1/internal/background"
	"github.com/charliearnerstal/jarvis/s1/internal/commands"
	"github.com/charliearnerstal/jarvis/s1/internal/config"
	"github.com/charliearnerstal/jarvis/s1/internal/instance"
	"github.com/charliearnerstal/jarvis/s1/internal/protocol"
	"github.com/charliearnerstal/jarvis/s1/internal/startup"
	"github.com/charliearnerstal/jarvis/s1/internal/updater"
	"github.com/gorilla/websocket"
)

var (
	defaultVersion        = "0.1.0"
	defaultServerURL      = ""
	defaultBootstrapToken = ""
)

var (
	errRestartRequested = errors.New("agent restart requested")
	errReenrollRequired = errors.New("agent re-enrollment required")
)

const (
	startupRefreshInterval   = 6 * time.Hour
	maxInitResponseBodyBytes = 64 * 1024
)

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

	flag.StringVar(&serverURLFlag, "server-url", resolveStringSetting("JARVIS_SERVER_URL", defaultServerURL), "Server base URL (e.g. https://jarvis.example)")
	flag.StringVar(&deviceIDFlag, "device-id", "", "Device ID (e.g. s1)")
	flag.StringVar(&displayNameFlag, "display-name", strings.TrimSpace(os.Getenv("JARVIS_DISPLAY_NAME")), "Shared display name shown by remotes for this device")
	flag.StringVar(&bootstrapTokenFlag, "bootstrap-token", resolveStringSetting("JARVIS_BOOTSTRAP_TOKEN", defaultBootstrapToken), "Bootstrap token for first-run enrollment")
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

	if enrollOnlyFlag {
		if _, err := initializeAgent(cfgPath, strings.TrimSpace(serverURLFlag), strings.TrimSpace(deviceIDFlag), strings.TrimSpace(displayNameFlag), strings.TrimSpace(bootstrapTokenFlag), strings.TrimSpace(versionFlag), executablePath, execPathErr == nil); err != nil {
			log.Fatalf("initialize agent: %v", err)
		}
		return
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if execPathErr == nil {
		go maintainStartupRegistration(ctx, executablePath)
	}

	superviseAgent(ctx, cfgPath, strings.TrimSpace(serverURLFlag), strings.TrimSpace(deviceIDFlag), strings.TrimSpace(displayNameFlag), strings.TrimSpace(bootstrapTokenFlag), strings.TrimSpace(versionFlag), executablePath, execPathErr == nil)
}

func firstRunEnroll(cfgPath string, serverBaseURL string, deviceIDInput string, displayNameInput string, bootstrapToken string, version string) (*config.Config, error) {
	if serverBaseURL == "" {
		return nil, errors.New("missing server URL; pass --server-url or set JARVIS_SERVER_URL")
	}

	if bootstrapToken == "" {
		return nil, errors.New("missing bootstrap token; pass --bootstrap-token or set JARVIS_BOOTSTRAP_TOKEN")
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
	} else if !strings.HasPrefix(deviceID, "s") {
		deviceID = config.SanitizeDeviceID("s-" + deviceID)
	}

	base := normalizeBaseURL(serverBaseURL)

	displayName := strings.TrimSpace(displayNameInput)
	if displayName == "" {
		if autoDesignate {
			displayName = "s-agent"
		} else {
			displayName = deviceID
		}
	}

	requestPayload := enrollRequest{
		BootstrapToken:    bootstrapToken,
		DeviceID:          deviceID,
		DesignationPrefix: "s",
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

	client := newHTTPClient(20 * time.Second)

	resp, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("send enroll request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxInitResponseBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("read enroll response: %w", err)
	}

	var enrollResp enrollResponse
	if len(body) > 0 {
		if err := json.Unmarshal(body, &enrollResp); err != nil && resp.StatusCode < 300 {
			return nil, fmt.Errorf("parse enroll response: %w", err)
		}
	}

	if resp.StatusCode >= 300 || !enrollResp.OK {
		enrollResp.Message = firstNonEmpty(enrollResp.Message, httpErrorMessage(resp.Status, body))
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

func initializeAgent(cfgPath string, serverURL string, deviceID string, displayName string, bootstrapToken string, version string, executablePath string, ensureStartup bool) (*config.Config, error) {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			if canReenroll(serverURL, bootstrapToken) {
				if backupPath, backupErr := archiveInvalidConfig(cfgPath); backupErr != nil {
					return nil, fmt.Errorf("archive invalid config after %v: %w", err, backupErr)
				} else if backupPath != "" {
					log.Printf("archived invalid config to %s after load failure: %v", backupPath, err)
				}
			} else {
				return nil, fmt.Errorf("load config: %w", err)
			}
		}

		cfg, err = firstRunEnroll(cfgPath, serverURL, deviceID, displayName, bootstrapToken, version)
		if err != nil {
			return nil, fmt.Errorf("first-run enrollment failed: %w", err)
		}
		log.Printf("enrollment complete for device %s", cfg.DeviceID)
	}

	serverURL = normalizeBaseURL(serverURL)
	if serverURL != "" {
		cfg.ServerBaseURL = serverURL
	}

	if version != "" {
		cfg.Version = version
	}

	if cfg.HeartbeatSeconds <= 0 {
		cfg.HeartbeatSeconds = 60
	}

	if serverURL != "" || !isValidWSURL(cfg.WSURL) {
		wsURL, err := deriveWSURL(cfg.ServerBaseURL)
		if err != nil {
			return nil, fmt.Errorf("derive websocket URL: %w", err)
		}
		cfg.WSURL = wsURL
	}

	if cfg.DeviceID == "" {
		return nil, errors.New("config missing device_id")
	}

	if err := config.Save(cfgPath, cfg); err != nil {
		return nil, fmt.Errorf("persist config: %w", err)
	}

	if ensureStartup {
		if err := startup.EnsureStartupRegistration(executablePath); err != nil {
			log.Printf("warning: startup registration failed: %v", err)
		}
	}

	return cfg, nil
}

func superviseAgent(ctx context.Context, cfgPath string, serverURL string, deviceID string, displayName string, bootstrapToken string, version string, executablePath string, ensureStartup bool) {
	backoff := 2 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		cfg, err := initializeAgent(cfgPath, serverURL, deviceID, displayName, bootstrapToken, version, executablePath, ensureStartup)
		if err != nil {
			log.Printf("initialization failed: %v", err)
			if !waitForRetry(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		backoff = 2 * time.Second
		if err := runLoop(ctx, cfg, cfgPath); err != nil {
			if errors.Is(err, errRestartRequested) {
				return
			}
			if errors.Is(err, errReenrollRequired) {
				if !canReenroll(serverURL, bootstrapToken) {
					log.Printf("session requires re-enrollment but bootstrap settings are unavailable")
				} else if backupPath, backupErr := archiveInvalidConfig(cfgPath); backupErr != nil {
					log.Printf("warning: archive config for re-enrollment failed: %v", backupErr)
				} else if backupPath != "" {
					log.Printf("archived stale config to %s before re-enrollment", backupPath)
				}

				if !waitForRetry(ctx, 2*time.Second) {
					return
				}
				backoff = 2 * time.Second
				continue
			}
			log.Printf("agent loop ended: %v", err)
			if !waitForRetry(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		return
	}
}

func runLoop(ctx context.Context, cfg *config.Config, cfgPath string) error {
	backoff := 2 * time.Second

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		err := safeRunSession(ctx, cfg, cfgPath)
		if err == nil {
			return nil
		}

		if errors.Is(err, errRestartRequested) {
			return err
		}

		log.Printf("session ended: %v", err)
		if !waitForRetry(ctx, backoff) {
			return nil
		}
		backoff = nextBackoff(backoff)
	}
}

func runSession(ctx context.Context, cfg *config.Config, cfgPath string) error {
	dialer := newWebsocketDialer()
	conn, resp, err := dialer.DialContext(ctx, cfg.WSURL, nil)
	if err != nil {
		return classifyDialError(err, resp)
	}
	defer conn.Close()
	conn.SetReadLimit(65_536)
	extendReadDeadline := func() error {
		return conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
	}
	if err := extendReadDeadline(); err != nil {
		return fmt.Errorf("set initial read deadline: %w", err)
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
			_, payload, err := conn.ReadMessage()
			if err != nil {
				sendError(classifySessionReadError(err))
				return
			}
			if err := extendReadDeadline(); err != nil {
				sendError(fmt.Errorf("refresh read deadline: %w", err))
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

	basePath := strings.TrimSuffix(parsed.Path, "/")
	if basePath == "" {
		parsed.Path = "/ws/agent"
	} else {
		parsed.Path = basePath + "/ws/agent"
	}
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

	return filepath.Join(localAppData, "S1Agent", "s1-agent.exe"), nil
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

func waitForRetry(ctx context.Context, backoff time.Duration) bool {
	jitter := time.Duration(time.Now().UnixNano()%500) * time.Millisecond
	timer := time.NewTimer(backoff + jitter)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(current time.Duration) time.Duration {
	if current < 30*time.Second {
		current *= 2
		if current > 30*time.Second {
			return 30 * time.Second
		}
	}

	return current
}

func newHTTPClient(timeout time.Duration) *http.Client {
	transport, _ := http.DefaultTransport.(*http.Transport)
	if transport == nil {
		return &http.Client{Timeout: timeout}
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: transport.Clone(),
	}
}

func newWebsocketDialer() *websocket.Dialer {
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second
	return &dialer
}

func httpErrorMessage(status string, body []byte) string {
	bodyText := strings.TrimSpace(string(body))
	if bodyText == "" {
		return status
	}

	return fmt.Sprintf("%s: %s", status, bodyText)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}

	return ""
}

func canReenroll(serverURL string, bootstrapToken string) bool {
	return strings.TrimSpace(serverURL) != "" && strings.TrimSpace(bootstrapToken) != ""
}

func archiveInvalidConfig(cfgPath string) (string, error) {
	if strings.TrimSpace(cfgPath) == "" {
		return "", nil
	}

	if _, err := os.Stat(cfgPath); errors.Is(err, os.ErrNotExist) {
		return "", nil
	} else if err != nil {
		return "", err
	}

	backupPath := fmt.Sprintf("%s.broken-%d", cfgPath, time.Now().UTC().UnixNano())
	if err := os.Rename(cfgPath, backupPath); err != nil {
		return "", err
	}

	return backupPath, nil
}

func isValidWSURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}

	if parsed.Host == "" {
		return false
	}

	return parsed.Scheme == "ws" || parsed.Scheme == "wss"
}

func classifyDialError(err error, resp *http.Response) error {
	if resp == nil {
		return fmt.Errorf("connect websocket: %w", err)
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	message := httpErrorMessage(resp.Status, body)
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("%w: websocket handshake rejected: %s", errReenrollRequired, message)
	}

	return fmt.Errorf("connect websocket: %s: %w", message, err)
}

func classifySessionReadError(err error) error {
	var closeErr *websocket.CloseError
	if errors.As(err, &closeErr) {
		reason := strings.TrimSpace(closeErr.Text)
		if closeErr.Code == 4003 && strings.EqualFold(reason, "Invalid device token") {
			return fmt.Errorf("%w: %s", errReenrollRequired, reason)
		}

		return fmt.Errorf("read message: websocket closed (%d): %s", closeErr.Code, reason)
	}

	return fmt.Errorf("read message: %w", err)
}
