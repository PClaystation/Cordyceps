package commands

import (
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/charliearnerstal/jarvis/agent/internal/protocol"
)

const commandTimeout = 8 * time.Second

var openAppTargets = map[string]string{
	"spotify": "spotify:",
	"discord": "discord://",
	"chrome":  "chrome",
}

func Capabilities() []string {
	return []string{
		"media_control",
		"notifications",
		"locking",
		"open_app",
	}
}

func Execute(deviceID string, version string, command protocol.CommandEnvelope) protocol.ResultMessage {
	result := protocol.ResultMessage{
		Kind:       "result",
		RequestID:  command.RequestID,
		DeviceID:   deviceID,
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
		Version:    version,
	}

	handleErr := func(err error, code string) protocol.ResultMessage {
		result.OK = false
		result.ErrorCode = code
		result.Message = err.Error()
		return result
	}

	switch strings.ToUpper(command.Type) {
	case "PING":
		result.OK = true
		result.Message = fmt.Sprintf("%s is online", deviceID)
		return result
	case "OPEN_APP":
		app, err := readStringArg(command.Args, "app")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := openApp(app); err != nil {
			return handleErr(err, "OPEN_APP_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("Opened %s", app)
		return result
	case "MEDIA_PLAY":
		if err := sendMediaKey("MEDIA_PLAY_PAUSE"); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		result.Message = "Play command sent"
		return result
	case "MEDIA_PAUSE":
		if err := sendMediaKey("MEDIA_PLAY_PAUSE"); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		result.Message = "Pause command sent"
		return result
	case "MEDIA_NEXT":
		if err := sendMediaKey("MEDIA_NEXT_TRACK"); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		result.Message = "Next track command sent"
		return result
	case "MEDIA_PREVIOUS":
		if err := sendMediaKey("MEDIA_PREV_TRACK"); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		result.Message = "Previous track command sent"
		return result
	case "VOLUME_UP":
		if err := sendMediaKey("VOLUME_UP"); err != nil {
			return handleErr(err, "VOLUME_FAILED")
		}

		result.OK = true
		result.Message = "Volume up command sent"
		return result
	case "VOLUME_DOWN":
		if err := sendMediaKey("VOLUME_DOWN"); err != nil {
			return handleErr(err, "VOLUME_FAILED")
		}

		result.OK = true
		result.Message = "Volume down command sent"
		return result
	case "MUTE":
		if err := sendMediaKey("VOLUME_MUTE"); err != nil {
			return handleErr(err, "VOLUME_FAILED")
		}

		result.OK = true
		result.Message = "Mute command sent"
		return result
	case "LOCK_PC":
		if err := lockPC(); err != nil {
			return handleErr(err, "LOCK_FAILED")
		}

		result.OK = true
		result.Message = "PC locked"
		return result
	case "NOTIFY":
		text, err := readStringArg(command.Args, "text")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := notify(text); err != nil {
			return handleErr(err, "NOTIFY_FAILED")
		}

		result.OK = true
		result.Message = "Notification shown"
		return result
	default:
		return handleErr(fmt.Errorf("unknown command type: %s", command.Type), "UNKNOWN_TYPE")
	}
}

func readStringArg(args map[string]any, key string) (string, error) {
	value, ok := args[key]
	if !ok {
		return "", fmt.Errorf("missing arg: %s", key)
	}

	asString, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("arg must be string: %s", key)
	}

	asString = strings.TrimSpace(asString)
	if asString == "" {
		return "", fmt.Errorf("arg must not be empty: %s", key)
	}

	return asString, nil
}

func openApp(app string) error {
	if runtime.GOOS != "windows" {
		return errors.New("OPEN_APP is supported only on Windows")
	}

	target, ok := openAppTargets[strings.ToLower(strings.TrimSpace(app))]
	if !ok {
		return fmt.Errorf("app not allowlisted: %s", app)
	}

	cmd := exec.Command("cmd", "/C", "start", "", target)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch %s: %w", app, err)
	}

	return nil
}

func sendMediaKey(key string) error {
	if runtime.GOOS != "windows" {
		return errors.New("media keys are supported only on Windows")
	}

	script := fmt.Sprintf("(New-Object -ComObject WScript.Shell).SendKeys('{%s}')", key)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("send key %s: %w", key, err)
	}

	return nil
}

func lockPC() error {
	if runtime.GOOS != "windows" {
		return errors.New("LOCK_PC is supported only on Windows")
	}

	cmd := exec.Command("rundll32.exe", "user32.dll,LockWorkStation")
	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("lock workstation: %w", err)
	}

	return nil
}

func notify(text string) error {
	if runtime.GOOS != "windows" {
		return errors.New("NOTIFY is supported only on Windows")
	}

	if len(text) > 180 {
		return errors.New("notification text too long")
	}

	escaped := strings.ReplaceAll(text, "'", "''")
	script := fmt.Sprintf("$w = New-Object -ComObject WScript.Shell; $null = $w.Popup('%s', 3, 'Jarvis', 64)", escaped)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("show notification: %w", err)
	}

	return nil
}

func runWithTimeout(cmd *exec.Cmd, timeout time.Duration) error {
	if err := cmd.Start(); err != nil {
		return err
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		return errors.New("command timed out")
	}
}
