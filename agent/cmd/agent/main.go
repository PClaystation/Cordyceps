package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/charliearnerstal/jarvis/agent/internal/commands"
	"github.com/charliearnerstal/jarvis/agent/internal/config"
	"github.com/charliearnerstal/jarvis/agent/internal/protocol"
	"github.com/charliearnerstal/jarvis/agent/internal/startup"
	"github.com/gorilla/websocket"
)

const defaultVersion = "0.1.0"

type enrollRequest struct {
	BootstrapToken string   `json:"bootstrap_token"`
	DeviceID       string   `json:"device_id"`
	DisplayName    string   `json:"display_name,omitempty"`
	Version        string   `json:"version"`
	Hostname       string   `json:"hostname"`
	Username       string   `json:"username"`
	Capabilities   []string `json:"capabilities"`
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
		serverURLFlag     string
		deviceIDFlag      string
		bootstrapTokenFlag string
		versionFlag       string
		configPathFlag    string
		enrollOnlyFlag    bool
	)

	flag.StringVar(&serverURLFlag, "server-url", strings.TrimSpace(os.Getenv("JARVIS_SERVER_URL")), "Server base URL (e.g. https://jarvis.example)")
	flag.StringVar(&deviceIDFlag, "device-id", "", "Device ID (e.g. m1)")
	flag.StringVar(&bootstrapTokenFlag, "bootstrap-token", strings.TrimSpace(os.Getenv("JARVIS_BOOTSTRAP_TOKEN")), "Bootstrap token for first-run enrollment")
	flag.StringVar(&versionFlag, "version", defaultVersion, "Agent version string")
	flag.StringVar(&configPathFlag, "config", "", "Path to agent config file")
	flag.BoolVar(&enrollOnlyFlag, "enroll-only", false, "Enroll and exit")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.LUTC)

	cfgPath := strings.TrimSpace(configPathFlag)
	if cfgPath == "" {
		var err error
		cfgPath, err = config.DefaultConfigPath()
		if err != nil {
			log.Fatalf("resolve config path: %v", err)
		}
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Fatalf("load config: %v", err)
		}

		cfg, err = firstRunEnroll(cfgPath, strings.TrimSpace(serverURLFlag), strings.TrimSpace(deviceIDFlag), strings.TrimSpace(bootstrapTokenFlag), strings.TrimSpace(versionFlag))
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

	executablePath, err := os.Executable()
	if err == nil {
		if startupErr := startup.EnsureStartupRegistration(executablePath); startupErr != nil {
			log.Printf("warning: startup registration failed: %v", startupErr)
		}
	} else {
		log.Printf("warning: resolve executable path failed: %v", err)
	}

	if enrollOnlyFlag {
		return
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	runLoop(ctx, cfg)
}

func firstRunEnroll(cfgPath string, serverBaseURL string, deviceIDInput string, bootstrapToken string, version string) (*config.Config, error) {
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
	if strings.TrimSpace(deviceIDInput) == "" {
		deviceID = config.SanitizeDeviceID(hostname)
	}
	if !strings.HasPrefix(deviceID, "m") {
		deviceID = config.SanitizeDeviceID("m-" + deviceID)
	}

	base := normalizeBaseURL(serverBaseURL)

	requestPayload := enrollRequest{
		BootstrapToken: bootstrapToken,
		DeviceID:       deviceID,
		DisplayName:    deviceID,
		Version:        version,
		Hostname:       hostname,
		Username:       username,
		Capabilities:   commands.Capabilities(),
	}

	payload, err := json.Marshal(requestPayload)
	if err != nil {
		return nil, fmt.Errorf("serialize enroll request: %w", err)
	}

	resp, err := http.Post(base+"/api/enroll", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("post enroll request: %w", err)
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

	wsURL := strings.TrimSpace(enrollResp.WSURL)
	if wsURL == "" {
		wsURL, err = deriveWSURL(base)
		if err != nil {
			return nil, fmt.Errorf("derive websocket URL: %w", err)
		}
	}

	cfg := &config.Config{
		DeviceID:         enrollResp.DeviceID,
		DeviceToken:      enrollResp.DeviceToken,
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

func runLoop(ctx context.Context, cfg *config.Config) {
	backoff := 2 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := runSession(ctx, cfg)
		if err == nil {
			return
		}

		log.Printf("session ended: %v", err)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func runSession(ctx context.Context, cfg *config.Config) error {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(cfg.WSURL, nil)
	if err != nil {
		return fmt.Errorf("connect websocket: %w", err)
	}
	defer conn.Close()

	hostname, _ := os.Hostname()
	username := strings.TrimSpace(os.Getenv("USERNAME"))
	if username == "" {
		username = strings.TrimSpace(os.Getenv("USER"))
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

	go func() {
		for {
			select {
			case <-ctx.Done():
				errorCh <- nil
				return
			case <-heartbeatTicker.C:
				hb := protocol.HeartbeatMessage{
					Kind:     "heartbeat",
					DeviceID: cfg.DeviceID,
					SentAt:   time.Now().UTC().Format(time.RFC3339),
				}

				if err := sendJSON(hb); err != nil {
					errorCh <- fmt.Errorf("send heartbeat: %w", err)
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
				errorCh <- fmt.Errorf("read message: %w", err)
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
						Kind:       "result",
						RequestID:  command.RequestID,
						DeviceID:   cfg.DeviceID,
						OK:         false,
						Message:    "device_id mismatch",
						ErrorCode:  "DEVICE_MISMATCH",
						CompletedAt: time.Now().UTC().Format(time.RFC3339),
						Version:    cfg.Version,
					}
					_ = sendJSON(result)
					continue
				}

				result := commands.Execute(cfg.DeviceID, cfg.Version, command)
				if err := sendJSON(result); err != nil {
					errorCh <- fmt.Errorf("send result: %w", err)
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
