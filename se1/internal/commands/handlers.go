package commands

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/charliearnerstal/jarvis/se1/internal/protocol"
)

const commandTimeout = 8 * time.Second
const emergencyCommandTimeout = 20 * time.Second
const emergencyCooldown = 60 * time.Second
const defaultEmergencyRollbackMinutes = 30
const minEmergencyRollbackMinutes = 1
const maxEmergencyRollbackMinutes = 240
const maxClipboardTextLength = 1000
const emergencyActiveCommandGrace = 5 * time.Second

var enabledCommandTypes = map[string]struct{}{
	"PING":               {},
	"OPEN_APP":           {},
	"MEDIA_PLAY":         {},
	"MEDIA_PAUSE":        {},
	"MEDIA_PLAY_PAUSE":   {},
	"MEDIA_NEXT":         {},
	"MEDIA_PREVIOUS":     {},
	"VOLUME_UP":          {},
	"VOLUME_DOWN":        {},
	"BRIGHTNESS_UP":      {},
	"BRIGHTNESS_DOWN":    {},
	"MUTE":               {},
	"KEY_F1":             {},
	"KEY_F2":             {},
	"KEY_F3":             {},
	"KEY_F4":             {},
	"KEY_F5":             {},
	"KEY_F6":             {},
	"KEY_F7":             {},
	"KEY_F8":             {},
	"KEY_F9":             {},
	"KEY_F10":            {},
	"KEY_F11":            {},
	"KEY_F12":            {},
	"LOCK_PC":            {},
	"NOTIFY":             {},
	"CLIPBOARD_SET":      {},
	"SYSTEM_DISPLAY_OFF": {},
	"EMERGENCY_LOCKDOWN": {},
}

var emergencyState struct {
	mu            sync.Mutex
	inProgress    bool
	lastTriggered time.Time
}

type emergencyStatus struct {
	ActiveUntil   string `json:"active_until,omitempty"`
	LastTriggered string `json:"last_triggered,omitempty"`
	LastRequestID string `json:"last_request_id,omitempty"`
}

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
		"profile_se",
		"media_control",
		"notifications",
		"clipboard_control",
		"display_control",
		"keyboard_control",
		"locking",
		"emergency_lockdown",
		"open_app",
		"updater",
		"privileged_helper_split",
		"lite_profile_s1",
		"safe_profile_se1",
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

	commandType := strings.ToUpper(strings.TrimSpace(command.Type))
	if !isEnabledCommandType(commandType) {
		return handleErr(fmt.Errorf("%s is disabled in SE1 safety profile", commandType), "COMMAND_DISABLED")
	}

	if isRestrictedDuringEmergency(commandType) {
		active, until, err := emergencyActiveWindow()
		if err != nil {
			return handleErr(fmt.Errorf("read emergency status: %w", err), "EMERGENCY_STATE_FAILED")
		}
		if active {
			return handleErr(fmt.Errorf("%s is blocked while emergency lockdown remains active until %s", commandType, until.UTC().Format(time.RFC3339)), "EMERGENCY_ACTIVE")
		}
	}

	switch commandType {
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
	case "SYSTEM_DISPLAY_OFF":
		if err := displayOff(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Display turned off"
		return result
	case "EMERGENCY_LOCKDOWN":
		rollbackMinutes, err := readOptionalIntArg(
			command.Args,
			"rollback_minutes",
			defaultEmergencyRollbackMinutes,
			minEmergencyRollbackMinutes,
			maxEmergencyRollbackMinutes,
		)
		if err != nil {
			return handleErr(err, "INVALID_ARGS")
		}

		if err := emergencyLockdown(command.RequestID, rollbackMinutes); err != nil {
			return handleErr(err, "EMERGENCY_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("Emergency lockdown executed: network blocked with %d-minute failsafe rollback, sync stopped, apps closed, workstation locked", rollbackMinutes)
		return result
	default:
		return handleErr(fmt.Errorf("unknown command type: %s", command.Type), "UNKNOWN_TYPE")
	}
}

func isEnabledCommandType(commandType string) bool {
	_, ok := enabledCommandTypes[commandType]
	return ok
}

func isRestrictedDuringEmergency(commandType string) bool {
	switch commandType {
	case "PING", "LOCK_PC", "EMERGENCY_LOCKDOWN":
		return false
	default:
		return true
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

func emergencyLockdown(requestID string, rollbackMinutes int) error {
	if runtime.GOOS != "windows" {
		return errors.New("EMERGENCY_LOCKDOWN is supported only on Windows")
	}

	if err := beginEmergencyLockdown(); err != nil {
		return err
	}
	defer endEmergencyLockdown()

	writeEmergencyAudit(requestID, "started")

	rollbackSeconds := rollbackMinutes * 60
	statePath, err := emergencyStatusPath()
	if err != nil {
		writeEmergencyAudit(requestID, fmt.Sprintf("failed:resolve-state-path:%v", err))
		return err
	}

	activeUntil := time.Now().Add(time.Duration(rollbackSeconds)*time.Second + emergencyActiveCommandGrace).UTC()
	script := fmt.Sprintf(`
$ErrorActionPreference = "Stop"
$ruleGroup = "SE1EmergencyLockdown"
$rollbackSeconds = %d
$statePath = %s
$activeUntil = %s
$requestId = %s
$stateDir = Split-Path -Parent $statePath
$statusPayload = @{
  active_until = $activeUntil
  last_triggered = (Get-Date).ToUniversalTime().ToString("o")
  last_request_id = $requestId
} | ConvertTo-Json -Compress

function Clear-EmergencyIsolation {
  Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule | Out-Null
  Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Enable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

try {
  Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule | Out-Null
  New-NetFirewallRule -DisplayName "SE1 Emergency Block Outbound" -Group $ruleGroup -Direction Outbound -Action Block -Profile Any -Enabled True | Out-Null
  New-NetFirewallRule -DisplayName "SE1 Emergency Block Inbound" -Group $ruleGroup -Direction Inbound -Action Block -Profile Any -Enabled True | Out-Null
  $ruleCount = @(Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue).Count
  if ($ruleCount -lt 2) {
    throw "failed to activate firewall isolation"
  }

  $activeAdapters = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq "Up" })
  foreach ($adapter in $activeAdapters) {
    try { Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop | Out-Null } catch {}
  }

  cmd.exe /C "ipconfig /release" | Out-Null
  cmd.exe /C "net use * /delete /y" | Out-Null
  Get-SmbMapping | ForEach-Object {
    try { Remove-SmbMapping -LocalPath $_.LocalPath -Force -UpdateProfile -ErrorAction Stop | Out-Null } catch {}
  }

  $syncApps = @("OneDrive","Dropbox","GoogleDriveFS","iCloudDrive","iCloudServices","Box","BoxSync","MegaSync","SynologyDrive")
  foreach ($name in $syncApps) {
    Get-Process -Name $name | Stop-Process -Force -ErrorAction SilentlyContinue
  }

  $safeApps = @("System","Registry","smss","csrss","wininit","services","lsass","winlogon","explorer","ShellExperienceHost","StartMenuExperienceHost","SearchHost","TextInputHost","RuntimeBroker","taskhostw","dwm","ctfmon","conhost","powershell","pwsh","cmd","se1-agent")
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $safeApps -notcontains $_.ProcessName } | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
  }

  $rollbackCommand = 'Start-Sleep -Seconds ' + $rollbackSeconds + '; Get-NetFirewallRule -Group ''' + $ruleGroup + ''' -ErrorAction SilentlyContinue | Remove-NetFirewallRule | Out-Null; Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Enable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue | Out-Null; if (Test-Path -LiteralPath ''' + $statePath + ''') { Remove-Item -LiteralPath ''' + $statePath + ''' -Force -ErrorAction SilentlyContinue }'
  $rollbackProcess = Start-Process -WindowStyle Hidden powershell -PassThru -ArgumentList @("-NoProfile","-NonInteractive","-WindowStyle","Hidden","-Command",$rollbackCommand)
  if (-not $rollbackProcess) {
    throw "failed to schedule rollback process"
  }

  Set-Content -LiteralPath $statePath -Value $statusPayload -Encoding UTF8 -Force
  rundll32.exe user32.dll,LockWorkStation | Out-Null
} catch {
  Clear-EmergencyIsolation
  throw
}
`, rollbackSeconds, psSingleQuoted(statePath), psSingleQuoted(activeUntil.Format(time.RFC3339)), psSingleQuoted(strings.TrimSpace(requestID)))

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	if err := runWithTimeout(cmd, emergencyCommandTimeout); err != nil {
		_ = clearEmergencyStatus()
		writeEmergencyAudit(requestID, fmt.Sprintf("failed:%v", err))
		return fmt.Errorf("run emergency lockdown: %w", err)
	}

	writeEmergencyAudit(requestID, fmt.Sprintf("completed:active-until=%s", activeUntil.Format(time.RFC3339)))
	return nil
}

func beginEmergencyLockdown() error {
	emergencyState.mu.Lock()
	defer emergencyState.mu.Unlock()

	now := time.Now()
	if emergencyState.inProgress {
		return errors.New("emergency lockdown is already running")
	}

	lastTriggered, err := readEmergencyCooldown()
	if err != nil {
		return fmt.Errorf("read emergency cooldown: %w", err)
	}
	if !lastTriggered.IsZero() && lastTriggered.After(emergencyState.lastTriggered) {
		emergencyState.lastTriggered = lastTriggered
	}

	if !emergencyState.lastTriggered.IsZero() {
		elapsed := now.Sub(emergencyState.lastTriggered)
		if elapsed < emergencyCooldown {
			remaining := (emergencyCooldown - elapsed).Round(time.Second)
			return fmt.Errorf("emergency lockdown cooldown active; retry in %s", remaining)
		}
	}

	emergencyState.inProgress = true
	return nil
}

func endEmergencyLockdown() {
	emergencyState.mu.Lock()
	defer emergencyState.mu.Unlock()
	emergencyState.inProgress = false
	emergencyState.lastTriggered = time.Now()
	_ = writeEmergencyCooldown(emergencyState.lastTriggered)
}

func emergencyStatusPath() (string, error) {
	programData := strings.TrimSpace(os.Getenv("PROGRAMDATA"))
	if programData == "" {
		return "", errors.New("PROGRAMDATA is not set")
	}

	statusDir := filepath.Join(programData, "SE1Agent")
	if err := os.MkdirAll(statusDir, 0o700); err != nil {
		return "", fmt.Errorf("create emergency status dir: %w", err)
	}

	return filepath.Join(statusDir, "emergency-status.json"), nil
}

func emergencyActiveWindow() (bool, time.Time, error) {
	statusPath, err := emergencyStatusPath()
	if err != nil {
		return false, time.Time{}, err
	}

	data, err := os.ReadFile(statusPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, time.Time{}, nil
		}
		return false, time.Time{}, err
	}

	var status emergencyStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return false, time.Time{}, err
	}

	if strings.TrimSpace(status.ActiveUntil) == "" {
		_ = os.Remove(statusPath)
		return false, time.Time{}, nil
	}

	activeUntil, err := time.Parse(time.RFC3339, status.ActiveUntil)
	if err != nil {
		return false, time.Time{}, err
	}

	if time.Now().UTC().Before(activeUntil) {
		return true, activeUntil, nil
	}

	_ = os.Remove(statusPath)
	return false, activeUntil, nil
}

func clearEmergencyStatus() error {
	statusPath, err := emergencyStatusPath()
	if err != nil {
		return err
	}

	if err := os.Remove(statusPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return nil
}

func emergencyCooldownPath() (string, error) {
	programData := strings.TrimSpace(os.Getenv("PROGRAMDATA"))
	if programData == "" {
		return "", errors.New("PROGRAMDATA is not set")
	}

	statusDir := filepath.Join(programData, "SE1Agent")
	if err := os.MkdirAll(statusDir, 0o700); err != nil {
		return "", fmt.Errorf("create emergency status dir: %w", err)
	}

	return filepath.Join(statusDir, "emergency-cooldown.json"), nil
}

func readEmergencyCooldown() (time.Time, error) {
	cooldownPath, err := emergencyCooldownPath()
	if err != nil {
		return time.Time{}, err
	}

	data, err := os.ReadFile(cooldownPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}

	var status emergencyStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return time.Time{}, err
	}

	if strings.TrimSpace(status.LastTriggered) == "" {
		return time.Time{}, nil
	}

	return time.Parse(time.RFC3339, status.LastTriggered)
}

func writeEmergencyCooldown(triggeredAt time.Time) error {
	cooldownPath, err := emergencyCooldownPath()
	if err != nil {
		return err
	}

	payload := emergencyStatus{
		LastTriggered: triggeredAt.UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return os.WriteFile(cooldownPath, data, 0o600)
}

func psSingleQuoted(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func writeEmergencyAudit(requestID string, status string) {
	programData := strings.TrimSpace(os.Getenv("PROGRAMDATA"))
	if programData == "" {
		return
	}

	auditDir := filepath.Join(programData, "SE1Agent")
	if err := os.MkdirAll(auditDir, 0o700); err != nil {
		return
	}

	auditPath := filepath.Join(auditDir, "emergency-audit.log")
	file, err := os.OpenFile(auditPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()

	safeRequestID := strings.ReplaceAll(strings.TrimSpace(requestID), " ", "_")
	safeStatus := strings.ReplaceAll(strings.TrimSpace(status), "\n", " ")
	line := fmt.Sprintf("%s request_id=%s status=%s\n", time.Now().UTC().Format(time.RFC3339), safeRequestID, safeStatus)
	_, _ = file.WriteString(line)
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
