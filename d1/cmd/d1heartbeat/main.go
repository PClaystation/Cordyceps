package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/config"
	"github.com/charliearnerstal/jarvis/d1/internal/instance"
	"github.com/charliearnerstal/jarvis/d1/internal/startup"
	"github.com/gorilla/websocket"
)

var heartbeatVersion = "0.1.0"

const (
	heartbeatLockSuffix     = "#heartbeat"
	initialReconnectBackoff = 2 * time.Second
	maxReconnectBackoff     = 1 * time.Minute
)

type heartbeatOptions struct {
	configPath   string
	startup      bool
	foreground   bool
	printVersion bool
}

type heartbeatHelloMessage struct {
	Kind     string `json:"kind"`
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
	Version  string `json:"version"`
	Hostname string `json:"hostname"`
	Username string `json:"username"`
}

type heartbeatMessage struct {
	Kind     string `json:"kind"`
	DeviceID string `json:"device_id"`
	SentAt   string `json:"sent_at"`
}

func main() {
	opts := parseHeartbeatOptions()
	if opts.printVersion {
		fmt.Println(strings.TrimSpace(heartbeatVersion))
		return
	}

	log.SetFlags(log.LstdFlags | log.LUTC)

	if err := runHeartbeat(opts); err != nil {
		log.Fatal(err)
	}
}

func parseHeartbeatOptions() heartbeatOptions {
	var opts heartbeatOptions
	flag.StringVar(&opts.configPath, "config", "", "Path to the d1 agent config file")
	flag.BoolVar(&opts.startup, "startup", true, "Register the heartbeat process to start automatically on Windows")
	flag.BoolVar(&opts.foreground, "foreground", false, "Run in the current console")
	flag.BoolVar(&opts.printVersion, "print-version", false, "Print heartbeat version and exit")
	flag.Parse()

	opts.configPath = strings.TrimSpace(opts.configPath)
	return opts
}

func runHeartbeat(opts heartbeatOptions) error {
	cfgPath := opts.configPath
	if cfgPath == "" {
		var err error
		cfgPath, err = config.DefaultConfigPath()
		if err != nil {
			return fmt.Errorf("resolve config path: %w", err)
		}
	}

	lock, err := instance.Acquire(cfgPath + heartbeatLockSuffix)
	if err != nil {
		if errors.Is(err, instance.ErrAlreadyRunning) {
			log.Printf("heartbeat process already running for config %s", cfgPath)
			return nil
		}
		return fmt.Errorf("acquire heartbeat instance lock: %w", err)
	}
	defer func() {
		if releaseErr := lock.Release(); releaseErr != nil {
			log.Printf("warning: release heartbeat lock failed: %v", releaseErr)
		}
	}()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	executablePath, err := os.Executable()
	if err == nil && executablePath != "" && opts.startup {
		if startupErr := startup.EnsureUserRunKeyRegistration(
			"D1Heartbeat",
			heartbeatStartupCommand(executablePath, cfgPath),
			[]string{"D1HeartbeatLogon", "D1HeartbeatBoot", "D1HeartbeatWatchdog"},
		); startupErr != nil {
			log.Printf("warning: heartbeat startup registration failed: %v", startupErr)
		}
	}

	return superviseHeartbeat(ctx, cfgPath)
}

func superviseHeartbeat(ctx context.Context, cfgPath string) error {
	backoff := initialReconnectBackoff

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		cfg, err := config.Load(cfgPath)
		if err != nil {
			log.Printf("heartbeat config unavailable: %v", err)
			if !waitForRetry(ctx, backoff) {
				return nil
			}
			backoff = nextBackoff(backoff)
			continue
		}

		if cfg.HeartbeatSeconds <= 0 {
			cfg.HeartbeatSeconds = 60
		}

		if err := runHeartbeatSession(ctx, cfg); err != nil {
			log.Printf("heartbeat session ended: %v", err)
			if !waitForRetry(ctx, backoff) {
				return nil
			}
			backoff = nextBackoff(backoff)
			continue
		}

		return nil
	}
}

func runHeartbeatSession(ctx context.Context, cfg *config.Config) error {
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
			return fmt.Errorf("dial heartbeat websocket: %s", resp.Status)
		}
		return fmt.Errorf("dial heartbeat websocket: %w", err)
	}
	defer conn.Close()

	conn.SetReadLimit(16 * 1024)
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

	hostname, username := currentIdentity()
	hello := heartbeatHelloMessage{
		Kind:     "heartbeat_hello",
		DeviceID: cfg.DeviceID,
		Token:    cfg.DeviceToken,
		Version:  firstNonEmpty(strings.TrimSpace(cfg.Version), strings.TrimSpace(heartbeatVersion), "0.1.0"),
		Hostname: hostname,
		Username: username,
	}

	conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
	if err := conn.WriteJSON(hello); err != nil {
		return fmt.Errorf("send heartbeat hello: %w", err)
	}

	readErrCh := make(chan error, 1)
	go func() {
		for {
			if err := extendReadDeadline(); err != nil {
				readErrCh <- err
				return
			}

			if _, _, err := conn.ReadMessage(); err != nil {
				readErrCh <- err
				return
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
			payload := heartbeatMessage{
				Kind:     "heartbeat",
				DeviceID: cfg.DeviceID,
				SentAt:   time.Now().UTC().Format(time.RFC3339),
			}
			conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
			if err := conn.WriteJSON(payload); err != nil {
				return fmt.Errorf("send heartbeat: %w", err)
			}
		}
	}
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

func heartbeatStartupCommand(executablePath string, cfgPath string) string {
	command := fmt.Sprintf(`"%s"`, executablePath)
	if strings.TrimSpace(cfgPath) != "" {
		command += fmt.Sprintf(` --config "%s"`, cfgPath)
	}
	return command
}

func waitForRetry(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(current time.Duration) time.Duration {
	if current <= 0 {
		return initialReconnectBackoff
	}

	next := current * 2
	if next > maxReconnectBackoff {
		return maxReconnectBackoff
	}
	return next
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
