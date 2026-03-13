package commands

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/charliearnerstal/jarvis/a1/internal/protocol"
)

const commandTimeout = 8 * time.Second
const adminCommandTimeout = 45 * time.Second
const maxClipboardTextLength = 1000
const maxTypeTextLength = 1000
const maxAdminInputLength = 4000
const maxAdminResultLength = 900
const maxAdminFileReadBytes = 16 * 1024
const maxAdminFileWriteBytes = 128 * 1024
const maxAdminListEntries = 120
const maxAdminTailLines = 200
const maxEventLogEntries = 25

var openAppTargets = map[string]string{
	"spotify":      "spotify:",
	"discord":      "discord://",
	"chrome":       "chrome",
	"steam":        "steam://open/main",
	"explorer":     "explorer",
	"vscode":       "code",
	"edge":         "msedge",
	"firefox":      "firefox",
	"notepad":      "notepad",
	"calculator":   "calc",
	"settings":     "ms-settings:",
	"slack":        "slack:",
	"teams":        "msteams:",
	"taskmanager":  "taskmgr",
	"controlpanel": "control",
	"paint":        "mspaint",
	"snippingtool": "snippingtool",
}

var keyboardSequences = map[string]string{
	"KEY_ENTER":           "{ENTER}",
	"KEY_ESCAPE":          "{ESC}",
	"KEY_TAB":             "{TAB}",
	"KEY_SPACE":           " ",
	"KEY_UP":              "{UP}",
	"KEY_DOWN":            "{DOWN}",
	"KEY_LEFT":            "{LEFT}",
	"KEY_RIGHT":           "{RIGHT}",
	"KEY_BACKSPACE":       "{BACKSPACE}",
	"KEY_DELETE":          "{DELETE}",
	"KEY_HOME":            "{HOME}",
	"KEY_END":             "{END}",
	"KEY_PAGE_UP":         "{PGUP}",
	"KEY_PAGE_DOWN":       "{PGDN}",
	"SHORTCUT_COPY":       "^c",
	"SHORTCUT_PASTE":      "^v",
	"SHORTCUT_CUT":        "^x",
	"SHORTCUT_UNDO":       "^z",
	"SHORTCUT_REDO":       "^y",
	"SHORTCUT_SELECT_ALL": "^a",
	"SHORTCUT_ALT_TAB":    "%{TAB}",
	"SHORTCUT_ALT_F4":     "%{F4}",
}

var mediaVirtualKeyCodes = map[string]uint16{
	"VOLUME_MUTE":      0xAD,
	"VOLUME_DOWN":      0xAE,
	"VOLUME_UP":        0xAF,
	"MEDIA_NEXT_TRACK": 0xB0,
	"MEDIA_PREV_TRACK": 0xB1,
	"MEDIA_PLAY_PAUSE": 0xB3,
	"F1":               0x70,
	"F2":               0x71,
	"F3":               0x72,
	"F4":               0x73,
	"F5":               0x74,
	"F6":               0x75,
	"F7":               0x76,
	"F8":               0x77,
	"F9":               0x78,
	"F10":              0x79,
	"F11":              0x7A,
	"F12":              0x7B,
}

func Capabilities() []string {
	return []string{
		"profile_a",
		"media_control",
		"notifications",
		"clipboard_control",
		"display_control",
		"keyboard_control",
		"advanced_keyboard_control",
		"locking",
		"open_app",
		"power_control",
		"session_control",
		"updater",
		"privileged_helper_split",
		"admin_ops",
		"admin_exec",
		"process_control",
		"service_control",
		"filesystem_control",
		"system_info",
		"network_control",
		"event_log_access",
		"environment_control",
		"admin_profile_a1",
	}
}

func Execute(deviceID string, version string, command protocol.CommandEnvelope) (result protocol.ResultMessage) {
	result = protocol.ResultMessage{
		Kind:          "result",
		RequestID:     command.RequestID,
		DeviceID:      deviceID,
		CompletedAt:   time.Now().UTC().Format(time.RFC3339),
		Version:       version,
		ResultPayload: map[string]any{"command_type": strings.ToUpper(strings.TrimSpace(command.Type))},
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			result.OK = false
			result.ErrorCode = "AGENT_PANIC"
			result.Message = "command handler panic recovered"
		}
	}()

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
	case "MEDIA_PLAY_PAUSE":
		if err := sendMediaKey("MEDIA_PLAY_PAUSE"); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		result.Message = "Play/pause toggled"
		return result
	case "MEDIA_NEXT":
		steps, err := readOptionalIntArg(command.Args, "steps", 1, 1, 20)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := sendMediaKeyRepeated("MEDIA_NEXT_TRACK", steps); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		if steps > 1 {
			result.Message = fmt.Sprintf("Next track command sent x%d", steps)
		} else {
			result.Message = "Next track command sent"
		}
		return result
	case "MEDIA_PREVIOUS":
		steps, err := readOptionalIntArg(command.Args, "steps", 1, 1, 20)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := sendMediaKeyRepeated("MEDIA_PREV_TRACK", steps); err != nil {
			return handleErr(err, "MEDIA_FAILED")
		}

		result.OK = true
		if steps > 1 {
			result.Message = fmt.Sprintf("Previous track command sent x%d", steps)
		} else {
			result.Message = "Previous track command sent"
		}
		return result
	case "VOLUME_UP":
		steps, err := readOptionalIntArg(command.Args, "steps", 1, 1, 20)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := sendMediaKeyRepeated("VOLUME_UP", steps); err != nil {
			return handleErr(err, "VOLUME_FAILED")
		}

		result.OK = true
		if steps > 1 {
			result.Message = fmt.Sprintf("Volume up command sent x%d", steps)
		} else {
			result.Message = "Volume up command sent"
		}
		return result
	case "VOLUME_DOWN":
		steps, err := readOptionalIntArg(command.Args, "steps", 1, 1, 20)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := sendMediaKeyRepeated("VOLUME_DOWN", steps); err != nil {
			return handleErr(err, "VOLUME_FAILED")
		}

		result.OK = true
		if steps > 1 {
			result.Message = fmt.Sprintf("Volume down command sent x%d", steps)
		} else {
			result.Message = "Volume down command sent"
		}
		return result
	case "BRIGHTNESS_UP":
		amount, err := readOptionalIntArg(command.Args, "amount", 10, 1, 100)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := adjustBrightness(amount, true); err != nil {
			return handleErr(err, "DISPLAY_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("Brightness increased by %d%%", amount)
		return result
	case "BRIGHTNESS_DOWN":
		amount, err := readOptionalIntArg(command.Args, "amount", 10, 1, 100)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := adjustBrightness(amount, false); err != nil {
			return handleErr(err, "DISPLAY_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("Brightness decreased by %d%%", amount)
		return result
	case "MUTE":
		if err := sendMediaKey("VOLUME_MUTE"); err != nil {
			return handleErr(err, "VOLUME_FAILED")
		}

		result.OK = true
		result.Message = "Mute command sent"
		return result
	case "KEY_F1", "KEY_F2", "KEY_F3", "KEY_F4", "KEY_F5", "KEY_F6", "KEY_F7", "KEY_F8", "KEY_F9", "KEY_F10", "KEY_F11", "KEY_F12":
		key := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(command.Type)), "KEY_")
		if err := sendMediaKey(key); err != nil {
			return handleErr(err, "KEYBOARD_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("%s key sent", key)
		return result
	case "KEY_ENTER", "KEY_ESCAPE", "KEY_TAB", "KEY_SPACE", "KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT", "KEY_BACKSPACE", "KEY_DELETE", "KEY_HOME", "KEY_END", "KEY_PAGE_UP", "KEY_PAGE_DOWN", "SHORTCUT_COPY", "SHORTCUT_PASTE", "SHORTCUT_CUT", "SHORTCUT_UNDO", "SHORTCUT_REDO", "SHORTCUT_SELECT_ALL", "SHORTCUT_ALT_TAB", "SHORTCUT_ALT_F4":
		action := strings.ToUpper(strings.TrimSpace(command.Type))
		if err := sendKeyboardAction(action); err != nil {
			return handleErr(err, "KEYBOARD_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("%s sent", strings.ToLower(strings.ReplaceAll(action, "_", " ")))
		return result
	case "TYPE_TEXT":
		text, err := readStringArg(command.Args, "text")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := sendTypedText(text); err != nil {
			return handleErr(err, "KEYBOARD_FAILED")
		}

		result.OK = true
		result.Message = "Text typed"
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
	case "CLIPBOARD_SET":
		text, err := readStringArg(command.Args, "text")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := setClipboard(text); err != nil {
			return handleErr(err, "CLIPBOARD_FAILED")
		}

		result.OK = true
		result.Message = "Clipboard updated"
		return result
	case "SYSTEM_SLEEP":
		if !destructivePowerCommandsEnabled() {
			return handleErr(errors.New("power commands are disabled by reliability policy"), "POWER_DISABLED")
		}

		if err := sleepPC(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Sleep command scheduled"
		return result
	case "SYSTEM_DISPLAY_OFF":
		if err := displayOff(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Display turned off"
		return result
	case "SYSTEM_SIGN_OUT":
		if !destructivePowerCommandsEnabled() {
			return handleErr(errors.New("power commands are disabled by reliability policy"), "POWER_DISABLED")
		}

		if err := signOut(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Sign out started"
		return result
	case "SYSTEM_SHUTDOWN":
		if !destructivePowerCommandsEnabled() {
			return handleErr(errors.New("power commands are disabled by reliability policy"), "POWER_DISABLED")
		}

		if err := shutdownPC(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Shutdown scheduled (5s)"
		return result
	case "SYSTEM_RESTART":
		if !destructivePowerCommandsEnabled() {
			return handleErr(errors.New("power commands are disabled by reliability policy"), "POWER_DISABLED")
		}

		if err := restartPC(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Restart scheduled (5s)"
		return result
	case "AGENT_REMOVE":
		if !agentRemovalEnabled() {
			return handleErr(errors.New("agent removal is disabled by reliability policy"), "REMOVE_DISABLED")
		}

		if err := removeAgentSilently(); err != nil {
			return handleErr(err, "REMOVE_FAILED")
		}

		result.OK = true
		result.Message = "Agent removal scheduled"
		return result
	case "ADMIN_EXEC_CMD":
		commandText, err := readStringArg(command.Args, "command")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := executeAdminCmd(commandText)
		if err != nil {
			return handleErr(err, "ADMIN_EXEC_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "ADMIN_EXEC_POWERSHELL":
		script, err := readStringArg(command.Args, "script")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := executeAdminPowerShell(script)
		if err != nil {
			return handleErr(err, "ADMIN_EXEC_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "PROCESS_LIST":
		filter, err := readOptionalStringArg(command.Args, "filter", "")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := listProcesses(filter)
		if err != nil {
			return handleErr(err, "PROCESS_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "PROCESS_KILL":
		target, err := readStringArg(command.Args, "target")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		force, err := readOptionalBoolArg(command.Args, "force", true)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := killProcess(target, force)
		if err != nil {
			return handleErr(err, "PROCESS_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "PROCESS_START":
		commandText, err := readStringArg(command.Args, "command")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := startProcess(commandText)
		if err != nil {
			return handleErr(err, "PROCESS_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "PROCESS_DETAILS":
		target, err := readStringArg(command.Args, "target")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := describeProcess(target)
		if err != nil {
			return handleErr(err, "PROCESS_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "SERVICE_LIST":
		filter, err := readOptionalStringArg(command.Args, "filter", "")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := listServices(filter)
		if err != nil {
			return handleErr(err, "SERVICE_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "SERVICE_CONTROL":
		action, err := readStringArg(command.Args, "action")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		name, err := readStringArg(command.Args, "name")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := controlService(action, name)
		if err != nil {
			return handleErr(err, "SERVICE_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "SERVICE_DETAILS":
		name, err := readStringArg(command.Args, "name")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := describeService(name)
		if err != nil {
			return handleErr(err, "SERVICE_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_READ":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		maxBytes, err := readOptionalIntArg(command.Args, "max_bytes", maxAdminFileReadBytes, 1, maxAdminFileReadBytes)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := readFileText(path, maxBytes)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_WRITE":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		text, err := readStringArg(command.Args, "text")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := writeFileText(path, text, false)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_APPEND":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		text, err := readStringArg(command.Args, "text")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := writeFileText(path, text, true)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_COPY":
		source, err := readStringArg(command.Args, "source")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		destination, err := readStringArg(command.Args, "destination")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := copyPath(source, destination)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_MOVE":
		source, err := readStringArg(command.Args, "source")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		destination, err := readStringArg(command.Args, "destination")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := movePath(source, destination)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_EXISTS":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := pathExists(path)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_HASH":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		algorithm, err := readOptionalStringArg(command.Args, "algorithm", "sha256")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := hashPath(path, algorithm)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_TAIL":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		lines, err := readOptionalIntArg(command.Args, "lines", 40, 1, maxAdminTailLines)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := tailFile(path, lines)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_DELETE":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := deletePath(path)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_LIST":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := listPath(path)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "FILE_MKDIR":
		path, err := readStringArg(command.Args, "path")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := makeDir(path)
		if err != nil {
			return handleErr(err, "FILESYSTEM_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "NETWORK_INFO":
		output, err := collectNetworkInfo()
		if err != nil {
			return handleErr(err, "NETWORK_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "NETWORK_TEST":
		host, err := readStringArg(command.Args, "host")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		port, err := readOptionalIntArg(command.Args, "port", 0, 0, 65535)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := testNetworkEndpoint(host, port)
		if err != nil {
			return handleErr(err, "NETWORK_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "NETWORK_FLUSH_DNS":
		output, err := flushDNSCache()
		if err != nil {
			return handleErr(err, "NETWORK_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "EVENT_LOG_QUERY":
		logName, err := readStringArg(command.Args, "log")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		limit, err := readOptionalIntArg(command.Args, "limit", 10, 1, maxEventLogEntries)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := queryEventLog(logName, limit)
		if err != nil {
			return handleErr(err, "EVENT_LOG_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "ENV_LIST":
		prefix, err := readOptionalStringArg(command.Args, "prefix", "")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := listEnvironment(prefix)
		if err != nil {
			return handleErr(err, "ENV_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "ENV_GET":
		key, err := readStringArg(command.Args, "key")
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		output, err := getEnvironment(key)
		if err != nil {
			return handleErr(err, "ENV_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
		return result
	case "SYSTEM_INFO":
		output, err := collectSystemInfo()
		if err != nil {
			return handleErr(err, "INFO_FAILED")
		}

		result.OK = true
		result.Message = output
		result.ResultPayload["output"] = output
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

func readOptionalIntArg(args map[string]any, key string, fallback int, min int, max int) (int, error) {
	value, ok := args[key]
	if !ok {
		return fallback, nil
	}

	var asInt int
	switch typed := value.(type) {
	case float64:
		if math.Trunc(typed) != typed {
			return 0, fmt.Errorf("arg must be integer: %s", key)
		}

		maxInt := int64(^uint(0) >> 1)
		minInt := -maxInt - 1
		if typed > float64(maxInt) || typed < float64(minInt) {
			return 0, fmt.Errorf("arg out of range: %s", key)
		}
		asInt = int(typed)
	case int:
		asInt = typed
	case int32:
		asInt = int(typed)
	case int64:
		maxInt := int64(^uint(0) >> 1)
		minInt := -maxInt - 1
		if typed > maxInt || typed < minInt {
			return 0, fmt.Errorf("arg out of range: %s", key)
		}
		asInt = int(typed)
	default:
		return 0, fmt.Errorf("arg must be number: %s", key)
	}

	if asInt < min || asInt > max {
		return 0, fmt.Errorf("arg %s out of range (%d-%d)", key, min, max)
	}

	return asInt, nil
}

func readOptionalBoolArg(args map[string]any, key string, fallback bool) (bool, error) {
	value, ok := args[key]
	if !ok {
		return fallback, nil
	}

	switch typed := value.(type) {
	case bool:
		return typed, nil
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		switch normalized {
		case "1", "true", "yes", "y", "on":
			return true, nil
		case "0", "false", "no", "n", "off":
			return false, nil
		default:
			return false, fmt.Errorf("arg must be bool: %s", key)
		}
	default:
		return false, fmt.Errorf("arg must be bool: %s", key)
	}
}

func readOptionalStringArg(args map[string]any, key string, fallback string) (string, error) {
	value, ok := args[key]
	if !ok {
		return fallback, nil
	}

	asString, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("arg must be string: %s", key)
	}

	return strings.TrimSpace(asString), nil
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
	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch %s: %w", app, err)
	}

	return nil
}

func sendMediaKeyRepeated(key string, steps int) error {
	for i := 0; i < steps; i++ {
		if err := sendMediaKey(key); err != nil {
			return err
		}

		if i+1 < steps {
			time.Sleep(120 * time.Millisecond)
		}
	}

	return nil
}

func sendMediaKey(key string) error {
	if runtime.GOOS != "windows" {
		return errors.New("media keys are supported only on Windows")
	}

	virtualKey, ok := mediaVirtualKeyCodes[strings.ToUpper(strings.TrimSpace(key))]
	if !ok {
		return fmt.Errorf("unsupported media key: %s", key)
	}

	if err := sendVirtualKey(virtualKey); err != nil {
		return fmt.Errorf("send key %s: %w", key, err)
	}

	return nil
}

func sendKeyboardAction(action string) error {
	sequence, ok := keyboardSequences[strings.ToUpper(strings.TrimSpace(action))]
	if !ok {
		return fmt.Errorf("unsupported keyboard action: %s", action)
	}

	return sendKeyboardSequence(sequence)
}

func sendTypedText(text string) error {
	if len(text) > maxTypeTextLength {
		return fmt.Errorf("typed text too long (max %d)", maxTypeTextLength)
	}

	sequence := escapeSendKeysText(text)
	if sequence == "" {
		return errors.New("typed text must include at least one character")
	}

	return sendKeyboardSequence(sequence)
}

func escapeSendKeysText(text string) string {
	var builder strings.Builder
	for _, r := range text {
		switch r {
		case '\r':
			continue
		case '\n':
			builder.WriteString("{ENTER}")
		case '\t':
			builder.WriteString("{TAB}")
		case '+', '^', '%', '~', '(', ')', '[', ']':
			builder.WriteRune('{')
			builder.WriteRune(r)
			builder.WriteRune('}')
		case '{':
			builder.WriteString("{{}")
		case '}':
			builder.WriteString("{}}")
		default:
			builder.WriteRune(r)
		}
	}

	return builder.String()
}

func sendKeyboardSequence(sequence string) error {
	if runtime.GOOS != "windows" {
		return errors.New("keyboard control is supported only on Windows")
	}

	script := fmt.Sprintf("(New-Object -ComObject WScript.Shell).SendKeys(%s)", psSingleQuoted(sequence))
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("send keyboard sequence: %w", err)
	}

	return nil
}

func sleepPC() error {
	if runtime.GOOS != "windows" {
		return errors.New("SYSTEM_SLEEP is supported only on Windows")
	}

	cmd := exec.Command("cmd", "/C", "start", "", "cmd", "/C", "timeout /t 2 /nobreak >nul & rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("schedule sleep: %w", err)
	}

	return nil
}

func shutdownPC() error {
	if runtime.GOOS != "windows" {
		return errors.New("SYSTEM_SHUTDOWN is supported only on Windows")
	}

	cmd := exec.Command("shutdown.exe", "/s", "/t", "5")
	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("schedule shutdown: %w", err)
	}

	return nil
}

func restartPC() error {
	if runtime.GOOS != "windows" {
		return errors.New("SYSTEM_RESTART is supported only on Windows")
	}

	cmd := exec.Command("shutdown.exe", "/r", "/t", "5")
	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("schedule restart: %w", err)
	}

	return nil
}

func lockPC() error {
	if runtime.GOOS != "windows" {
		return errors.New("LOCK_PC is supported only on Windows")
	}

	if err := lockWorkStationNative(); err != nil {
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

func setClipboard(text string) error {
	if runtime.GOOS != "windows" {
		return errors.New("CLIPBOARD_SET is supported only on Windows")
	}

	if len(text) > maxClipboardTextLength {
		return fmt.Errorf("clipboard text too long (max %d)", maxClipboardTextLength)
	}

	if err := setClipboardText(text); err != nil {
		return fmt.Errorf("set clipboard: %w", err)
	}

	return nil
}

func displayOff() error {
	if runtime.GOOS != "windows" {
		return errors.New("SYSTEM_DISPLAY_OFF is supported only on Windows")
	}

	if err := turnDisplayOffNative(); err != nil {
		return fmt.Errorf("turn display off: %w", err)
	}

	return nil
}

func adjustBrightness(amount int, increase bool) error {
	if runtime.GOOS != "windows" {
		return errors.New("brightness control is supported only on Windows")
	}

	script := fmt.Sprintf(`
$amount = %d
$increase = $%t
$monitor = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
$methods = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $monitor -or -not $methods) {
  throw "no supported brightness control found"
}

$current = [int]$monitor.CurrentBrightness
if ($increase) {
  $target = [Math]::Min(100, $current + $amount)
} else {
  $target = [Math]::Max(0, $current - $amount)
}

Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$target } | Out-Null
`, amount, increase)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("adjust brightness: %w", err)
	}

	return nil
}

func signOut() error {
	if runtime.GOOS != "windows" {
		return errors.New("SYSTEM_SIGN_OUT is supported only on Windows")
	}

	cmd := exec.Command("shutdown.exe", "/l")
	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("sign out: %w", err)
	}

	return nil
}

func removeAgentSilently() error {
	if runtime.GOOS != "windows" {
		return errors.New("AGENT_REMOVE is supported only on Windows")
	}

	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable path: %w", err)
	}

	cleanupScriptPath, err := writeAgentRemovalScript(executablePath, removalConfigPaths())
	if err != nil {
		return fmt.Errorf("prepare removal script: %w", err)
	}

	cmd := exec.Command(
		"powershell",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle",
		"Hidden",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		cleanupScriptPath,
	)

	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		_ = os.Remove(cleanupScriptPath)
		return fmt.Errorf("launch removal script: %w", err)
	}

	return nil
}

func writeAgentRemovalScript(executablePath string, configPaths []string) (string, error) {
	tempDir := os.TempDir()
	scriptPath := filepath.Join(tempDir, fmt.Sprintf("a1-agent-remove-%d.ps1", time.Now().UnixNano()))
	scriptSelf := psSingleQuoted(scriptPath)
	exe := psSingleQuoted(executablePath)

	quotedConfigPaths := make([]string, 0, len(configPaths))
	for _, path := range configPaths {
		if strings.TrimSpace(path) == "" {
			continue
		}

		quotedConfigPaths = append(quotedConfigPaths, psSingleQuoted(path))
	}

	configPathLiteral := "@()"
	if len(quotedConfigPaths) > 0 {
		configPathLiteral = "@(" + strings.Join(quotedConfigPaths, ", ") + ")"
	}

	script := fmt.Sprintf(`$ErrorActionPreference = "SilentlyContinue"
$executablePath = %s
$configPaths = %s
$scriptPath = %s
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$taskNames = @("A1Agent", "A1AgentBoot", "A1AgentWatchdog", "CordycepsAgent", "CordycepsAgentBoot", "CordycepsAgentWatchdog", "JarvisAgent", "JarvisAgentBoot", "JarvisAgentWatchdog")
$runKeyNames = @("A1Agent", "CordycepsAgent", "JarvisAgent")

Start-Sleep -Seconds 6

foreach ($taskName in $taskNames) {
  schtasks /Delete /TN $taskName /F 2>$null | Out-Null
}

foreach ($runKeyName in $runKeyNames) {
  Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
}

Get-Process | Where-Object { $_.Path -eq $executablePath } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

if (Test-Path -LiteralPath $executablePath) {
  Remove-Item -LiteralPath $executablePath -Force -ErrorAction SilentlyContinue
}

foreach ($configPath in $configPaths) {
  if (-not $configPath) {
    continue
  }

  if (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  }

  $configDir = Split-Path -Parent $configPath
  if ($configDir -and (Test-Path -LiteralPath $configDir)) {
    $remaining = @(Get-ChildItem -LiteralPath $configDir -Force -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) {
      Remove-Item -LiteralPath $configDir -Force -ErrorAction SilentlyContinue
    }
  }
}

$installRoot = Split-Path -Parent $executablePath
if ($installRoot -and (Test-Path -LiteralPath $installRoot)) {
  $remaining = @(Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue)
  if ($remaining.Count -eq 0) {
    Remove-Item -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue
  }
}

Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
`, exe, configPathLiteral, scriptSelf)

	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		return "", err
	}

	return scriptPath, nil
}

func removalConfigPaths() []string {
	seen := make(map[string]struct{})
	paths := make([]string, 0, 2)

	add := func(path string) {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			return
		}

		normalized := filepath.Clean(trimmed)
		if _, exists := seen[normalized]; exists {
			return
		}

		seen[normalized] = struct{}{}
		paths = append(paths, normalized)
	}

	if appData := strings.TrimSpace(os.Getenv("APPDATA")); appData != "" {
		add(filepath.Join(appData, "A1Agent", "config.json"))
	}

	if homeDir, err := os.UserHomeDir(); err == nil {
		add(filepath.Join(homeDir, ".a1-agent", "config.json"))
	}

	return paths
}

func executeAdminCmd(commandText string) (string, error) {
	trimmed := strings.TrimSpace(commandText)
	if trimmed == "" {
		return "", errors.New("command must not be empty")
	}

	if len(trimmed) > maxAdminInputLength {
		return "", fmt.Errorf("command too long (max %d)", maxAdminInputLength)
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("ADMIN_EXEC_CMD is supported only on Windows")
	}

	cmd := exec.Command("cmd", "/C", trimmed)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func executeAdminPowerShell(script string) (string, error) {
	trimmed := strings.TrimSpace(script)
	if trimmed == "" {
		return "", errors.New("script must not be empty")
	}

	if len(trimmed) > maxAdminInputLength {
		return "", fmt.Errorf("script too long (max %d)", maxAdminInputLength)
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("ADMIN_EXEC_POWERSHELL is supported only on Windows")
	}

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", trimmed)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func listProcesses(filter string) (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("PROCESS_LIST is supported only on Windows")
	}

	filter = strings.TrimSpace(filter)
	filterClause := ""
	if filter != "" {
		escapedFilter := strings.ReplaceAll(filter, "'", "''")
		filterClause = fmt.Sprintf(` | Where-Object { $_.ProcessName -like '*%s*' }`, escapedFilter)
	}

	script := fmt.Sprintf(`
Get-Process%s |
  Sort-Object ProcessName |
  Select-Object -First %d Id,ProcessName,CPU,WS |
  Format-Table -AutoSize |
  Out-String -Width 4096
`, filterClause, maxAdminListEntries)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func killProcess(target string, force bool) (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("PROCESS_KILL is supported only on Windows")
	}

	target = strings.TrimSpace(target)
	if target == "" {
		return "", errors.New("target must not be empty")
	}

	forceFlag := ""
	if force {
		forceFlag = " -Force"
	}

	if pid, err := strconv.Atoi(target); err == nil {
		script := fmt.Sprintf("Stop-Process -Id %d%s -ErrorAction Stop", pid, forceFlag)
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
		if _, runErr := runWithOutputTimeout(cmd, adminCommandTimeout); runErr != nil {
			return "", runErr
		}

		return clampResultMessage(fmt.Sprintf("Stopped process id %d", pid)), nil
	}

	escaped := strings.ReplaceAll(target, "'", "''")
	script := fmt.Sprintf("Stop-Process -Name '%s'%s -ErrorAction Stop", escaped, forceFlag)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	if _, runErr := runWithOutputTimeout(cmd, adminCommandTimeout); runErr != nil {
		return "", runErr
	}

	return clampResultMessage(fmt.Sprintf("Stopped process %s", target)), nil
}

func startProcess(commandText string) (string, error) {
	trimmed := strings.TrimSpace(commandText)
	if trimmed == "" {
		return "", errors.New("command must not be empty")
	}

	if len(trimmed) > maxAdminInputLength {
		return "", fmt.Errorf("command too long (max %d)", maxAdminInputLength)
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("PROCESS_START is supported only on Windows")
	}

	script := fmt.Sprintf(`
$commandText = %s
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList @("/C", $commandText) -WindowStyle Hidden -PassThru
"Started process id=$($proc.Id)"
`, psSingleQuoted(trimmed))

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func describeProcess(target string) (string, error) {
	trimmed := strings.TrimSpace(target)
	if trimmed == "" {
		return "", errors.New("target must not be empty")
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("PROCESS_DETAILS is supported only on Windows")
	}

	if pid, err := strconv.Atoi(trimmed); err == nil {
		script := fmt.Sprintf(`
Get-Process -Id %d -ErrorAction Stop |
  Select-Object Id,ProcessName,Path,StartTime,CPU,WS,HandleCount,Threads |
  Format-List |
  Out-String -Width 4096
`, pid)
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
		return runWithOutputTimeout(cmd, adminCommandTimeout)
	}

	escaped := strings.ReplaceAll(trimmed, "'", "''")
	script := fmt.Sprintf(`
Get-Process -Name '%s' -ErrorAction Stop |
  Select-Object -First 8 Id,ProcessName,Path,StartTime,CPU,WS |
  Format-Table -AutoSize |
  Out-String -Width 4096
`, escaped)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func listServices(filter string) (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("SERVICE_LIST is supported only on Windows")
	}

	filter = strings.TrimSpace(filter)
	filterClause := ""
	if filter != "" {
		escapedFilter := strings.ReplaceAll(filter, "'", "''")
		filterClause = fmt.Sprintf(` | Where-Object { $_.Name -like '*%s*' -or $_.DisplayName -like '*%s*' }`, escapedFilter, escapedFilter)
	}

	script := fmt.Sprintf(`
Get-Service%s |
  Sort-Object Name |
  Select-Object -First %d Name,DisplayName,Status,StartType |
  Format-Table -AutoSize |
  Out-String -Width 4096
`, filterClause, maxAdminListEntries)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func controlService(action string, name string) (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("SERVICE_CONTROL is supported only on Windows")
	}

	normalizedAction := strings.ToLower(strings.TrimSpace(action))
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return "", errors.New("service name must not be empty")
	}

	escapedName := strings.ReplaceAll(trimmedName, "'", "''")
	var command string
	var actionMessage string
	switch normalizedAction {
	case "start":
		command = fmt.Sprintf("Start-Service -Name '%s' -ErrorAction Stop", escapedName)
		actionMessage = "started"
	case "stop":
		command = fmt.Sprintf("Stop-Service -Name '%s' -Force -ErrorAction Stop", escapedName)
		actionMessage = "stopped"
	case "restart":
		command = fmt.Sprintf("Restart-Service -Name '%s' -Force -ErrorAction Stop", escapedName)
		actionMessage = "restarted"
	default:
		return "", fmt.Errorf("unsupported service action: %s", action)
	}

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command)
	if _, err := runWithOutputTimeout(cmd, adminCommandTimeout); err != nil {
		return "", err
	}

	return clampResultMessage(fmt.Sprintf("Service %s %s", trimmedName, actionMessage)), nil
}

func describeService(name string) (string, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return "", errors.New("service name must not be empty")
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("SERVICE_DETAILS is supported only on Windows")
	}

	script := fmt.Sprintf(`
$serviceName = %s
$svc = Get-Service -Name $serviceName -ErrorAction Stop
$wmi = Get-CimInstance Win32_Service | Where-Object { $_.Name -eq $serviceName } | Select-Object -First 1
"Name=$($svc.Name)"
"DisplayName=$($svc.DisplayName)"
"Status=$($svc.Status)"
if ($wmi) {
  "StartType=$($wmi.StartMode)"
  "PathName=$($wmi.PathName)"
  "Account=$($wmi.StartName)"
}
`, psSingleQuoted(trimmedName))

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func readFileText(path string, maxBytes int) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	file, err := os.Open(trimmedPath)
	if err != nil {
		return "", fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	reader := io.LimitReader(file, int64(maxBytes)+1)
	content, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}

	truncated := false
	if len(content) > maxBytes {
		content = content[:maxBytes]
		truncated = true
	}

	message := fmt.Sprintf("%s\n%s", trimmedPath, string(content))
	if truncated {
		message += "\n...(truncated)"
	}

	return clampResultMessage(message), nil
}

func writeFileText(path string, text string, appendMode bool) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	if len(text) > maxAdminFileWriteBytes {
		return "", fmt.Errorf("text too long (max %d bytes)", maxAdminFileWriteBytes)
	}

	dir := filepath.Dir(trimmedPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", fmt.Errorf("create parent dir: %w", err)
		}
	}

	flags := os.O_CREATE | os.O_WRONLY
	if appendMode {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
	}

	file, err := os.OpenFile(trimmedPath, flags, 0o600)
	if err != nil {
		return "", fmt.Errorf("open file for write: %w", err)
	}
	defer file.Close()

	if _, err := file.WriteString(text); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	if appendMode {
		return clampResultMessage(fmt.Sprintf("Appended %d bytes to %s", len(text), trimmedPath)), nil
	}

	return clampResultMessage(fmt.Sprintf("Wrote %d bytes to %s", len(text), trimmedPath)), nil
}

func copyPath(source string, destination string) (string, error) {
	trimmedSource := strings.TrimSpace(source)
	trimmedDestination := strings.TrimSpace(destination)
	if trimmedSource == "" || trimmedDestination == "" {
		return "", errors.New("source and destination must not be empty")
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("FILE_COPY is supported only on Windows")
	}

	script := fmt.Sprintf("Copy-Item -LiteralPath %s -Destination %s -Recurse -Force -ErrorAction Stop", psSingleQuoted(trimmedSource), psSingleQuoted(trimmedDestination))
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	if _, err := runWithOutputTimeout(cmd, adminCommandTimeout); err != nil {
		return "", err
	}

	return clampResultMessage(fmt.Sprintf("Copied %s -> %s", trimmedSource, trimmedDestination)), nil
}

func movePath(source string, destination string) (string, error) {
	trimmedSource := strings.TrimSpace(source)
	trimmedDestination := strings.TrimSpace(destination)
	if trimmedSource == "" || trimmedDestination == "" {
		return "", errors.New("source and destination must not be empty")
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("FILE_MOVE is supported only on Windows")
	}

	script := fmt.Sprintf("Move-Item -LiteralPath %s -Destination %s -Force -ErrorAction Stop", psSingleQuoted(trimmedSource), psSingleQuoted(trimmedDestination))
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	if _, err := runWithOutputTimeout(cmd, adminCommandTimeout); err != nil {
		return "", err
	}

	return clampResultMessage(fmt.Sprintf("Moved %s -> %s", trimmedSource, trimmedDestination)), nil
}

func pathExists(path string) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	info, err := os.Stat(trimmedPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return clampResultMessage(fmt.Sprintf("Path does not exist: %s", trimmedPath)), nil
		}
		return "", fmt.Errorf("stat path: %w", err)
	}

	if info.IsDir() {
		return clampResultMessage(fmt.Sprintf("Path exists: %s (dir)", trimmedPath)), nil
	}

	return clampResultMessage(fmt.Sprintf("Path exists: %s (file, %d bytes)", trimmedPath, info.Size())), nil
}

func hashPath(path string, algorithm string) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	normalizedAlgorithm := strings.ToUpper(strings.TrimSpace(algorithm))
	if normalizedAlgorithm == "" {
		normalizedAlgorithm = "SHA256"
	}

	switch normalizedAlgorithm {
	case "SHA256", "SHA1", "SHA384", "SHA512", "MD5":
	default:
		return "", fmt.Errorf("unsupported hash algorithm: %s", algorithm)
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("FILE_HASH is supported only on Windows")
	}

	script := fmt.Sprintf(`
$hash = Get-FileHash -LiteralPath %s -Algorithm %s -ErrorAction Stop
"algorithm=$($hash.Algorithm)"
"hash=$($hash.Hash)"
"path=$($hash.Path)"
`, psSingleQuoted(trimmedPath), normalizedAlgorithm)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func tailFile(path string, lines int) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	if lines < 1 || lines > maxAdminTailLines {
		return "", fmt.Errorf("lines out of range (1-%d)", maxAdminTailLines)
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("FILE_TAIL is supported only on Windows")
	}

	script := fmt.Sprintf(`
Get-Content -LiteralPath %s -Tail %d -ErrorAction Stop |
  Out-String -Width 4096
`, psSingleQuoted(trimmedPath), lines)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func deletePath(path string) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	if _, err := os.Stat(trimmedPath); err != nil {
		return "", fmt.Errorf("stat path: %w", err)
	}

	if err := os.RemoveAll(trimmedPath); err != nil {
		return "", fmt.Errorf("remove path: %w", err)
	}

	return clampResultMessage(fmt.Sprintf("Deleted %s", trimmedPath)), nil
}

func listPath(path string) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	entries, err := os.ReadDir(trimmedPath)
	if err != nil {
		return "", fmt.Errorf("list path: %w", err)
	}

	sort.Slice(entries, func(i int, j int) bool {
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	lines := []string{trimmedPath}
	limit := len(entries)
	truncated := false
	if limit > maxAdminListEntries {
		limit = maxAdminListEntries
		truncated = true
	}

	for idx := 0; idx < limit; idx++ {
		entry := entries[idx]
		entryType := "file"
		sizeLabel := ""
		if entry.IsDir() {
			entryType = "dir"
		} else if info, infoErr := entry.Info(); infoErr == nil {
			sizeLabel = fmt.Sprintf(" (%d bytes)", info.Size())
		}

		lines = append(lines, fmt.Sprintf("[%s] %s%s", entryType, entry.Name(), sizeLabel))
	}

	if truncated {
		lines = append(lines, "...(truncated)")
	}

	return clampResultMessage(strings.Join(lines, "\n")), nil
}

func makeDir(path string) (string, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "", errors.New("path must not be empty")
	}

	if err := os.MkdirAll(trimmedPath, 0o700); err != nil {
		return "", fmt.Errorf("create directory: %w", err)
	}

	return clampResultMessage(fmt.Sprintf("Ensured directory %s", trimmedPath)), nil
}

func collectSystemInfo() (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("SYSTEM_INFO is supported only on Windows")
	}

	script := `
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$boot = $os.LastBootUpTime
$memGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
"host=$($env:COMPUTERNAME)"
"user=$($env:USERNAME)"
"os=$($os.Caption) $($os.Version)"
"build=$($os.BuildNumber)"
"uptime_since=$boot"
"ram_gb=$memGb"
"domain=$($cs.Domain)"
`

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func collectNetworkInfo() (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("NETWORK_INFO is supported only on Windows")
	}

	script := `
"ip_config:"
Get-NetIPConfiguration |
  Select-Object InterfaceAlias,InterfaceDescription,IPv4Address,IPv6Address,IPv4DefaultGateway |
  Format-Table -AutoSize

"dns_servers:"
Get-DnsClientServerAddress |
  Select-Object InterfaceAlias,AddressFamily,ServerAddresses |
  Format-Table -AutoSize
`

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func testNetworkEndpoint(host string, port int) (string, error) {
	trimmedHost := strings.TrimSpace(host)
	if trimmedHost == "" {
		return "", errors.New("host must not be empty")
	}

	if len(trimmedHost) > 255 {
		return "", errors.New("host is too long")
	}

	if port < 0 || port > 65535 {
		return "", errors.New("port must be between 0 and 65535")
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("NETWORK_TEST is supported only on Windows")
	}

	script := fmt.Sprintf("$target = %s\n", psSingleQuoted(trimmedHost))
	if port > 0 {
		script += fmt.Sprintf(`
Test-NetConnection -ComputerName $target -Port %d -InformationLevel Detailed |
  Format-List |
  Out-String -Width 4096
`, port)
	} else {
		script += `
Test-NetConnection -ComputerName $target -InformationLevel Detailed |
  Format-List |
  Out-String -Width 4096
`
	}

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func flushDNSCache() (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("NETWORK_FLUSH_DNS is supported only on Windows")
	}

	cmd := exec.Command("ipconfig", "/flushdns")
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func queryEventLog(logName string, limit int) (string, error) {
	trimmedLog := strings.TrimSpace(logName)
	if trimmedLog == "" {
		return "", errors.New("log must not be empty")
	}

	if limit < 1 || limit > maxEventLogEntries {
		return "", fmt.Errorf("limit must be between 1 and %d", maxEventLogEntries)
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("EVENT_LOG_QUERY is supported only on Windows")
	}

	script := fmt.Sprintf(`
$logName = %s
Get-WinEvent -LogName $logName -MaxEvents %d -ErrorAction Stop |
  Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message |
  Format-List |
  Out-String -Width 4096
`, psSingleQuoted(trimmedLog), limit)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func listEnvironment(prefix string) (string, error) {
	normalizedPrefix := strings.TrimSpace(prefix)
	if len(normalizedPrefix) > 120 {
		return "", errors.New("prefix too long")
	}

	if runtime.GOOS != "windows" {
		return "", errors.New("ENV_LIST is supported only on Windows")
	}

	filterClause := ""
	if normalizedPrefix != "" {
		filterClause = fmt.Sprintf(" | Where-Object { $_.Name -like %s }", psSingleQuoted(normalizedPrefix+"*"))
	}

	script := fmt.Sprintf(`
Get-ChildItem Env:%s |
  Sort-Object Name |
  Select-Object -First %d Name,Value |
  Format-Table -AutoSize |
  Out-String -Width 4096
`, filterClause, maxAdminListEntries)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	return runWithOutputTimeout(cmd, adminCommandTimeout)
}

func getEnvironment(key string) (string, error) {
	trimmedKey := strings.TrimSpace(key)
	if trimmedKey == "" {
		return "", errors.New("key must not be empty")
	}

	if len(trimmedKey) > 120 {
		return "", errors.New("key too long")
	}

	value, ok := os.LookupEnv(trimmedKey)
	if !ok {
		return clampResultMessage(fmt.Sprintf("Environment variable not set: %s", trimmedKey)), nil
	}

	return clampResultMessage(fmt.Sprintf("%s=%s", trimmedKey, value)), nil
}

func psSingleQuoted(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func destructivePowerCommandsEnabled() bool {
	return isTruthyEnv("CORDYCEPS_ALLOW_POWER_COMMANDS") || isTruthyEnv("JARVIS_ALLOW_POWER_COMMANDS")
}

func agentRemovalEnabled() bool {
	return isTruthyEnv("CORDYCEPS_ALLOW_AGENT_REMOVE") || isTruthyEnv("JARVIS_ALLOW_AGENT_REMOVE")
}

func isTruthyEnv(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func clampResultMessage(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		trimmed = "Command completed with no output"
	}

	runes := []rune(trimmed)
	if len(runes) <= maxAdminResultLength {
		return trimmed
	}

	const suffix = "...(truncated)"
	suffixRunes := []rune(suffix)
	headLen := maxAdminResultLength - len(suffixRunes)
	if headLen < 1 {
		return string(suffixRunes[:maxAdminResultLength])
	}

	return string(runes[:headLen]) + suffix
}

func runWithOutputTimeout(cmd *exec.Cmd, timeout time.Duration) (string, error) {
	configureHiddenProcess(cmd)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	if err := cmd.Start(); err != nil {
		return "", err
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case err := <-done:
		outText := clampResultMessage(output.String())
		if err != nil {
			if strings.TrimSpace(outText) != "" && outText != "Command completed with no output" {
				return "", fmt.Errorf("%v | output: %s", err, outText)
			}

			return "", err
		}

		return outText, nil
	case <-timer.C:
		_ = cmd.Process.Kill()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
		return "", errors.New("command timed out")
	}
}

func runWithTimeout(cmd *exec.Cmd, timeout time.Duration) error {
	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case err := <-done:
		return err
	case <-timer.C:
		_ = cmd.Process.Kill()
		return errors.New("command timed out")
	}
}
