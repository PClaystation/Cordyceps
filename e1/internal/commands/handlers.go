package commands

import (
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

	"github.com/charliearnerstal/jarvis/e1/internal/protocol"
)

const commandTimeout = 8 * time.Second
const emergencyCommandTimeout = 20 * time.Second
const emergencyCooldown = 60 * time.Second
const emergencyRollbackMinutes = 30
const maxClipboardTextLength = 1000

var enabledCommandTypes = map[string]struct{}{
	"PING":               {},
	"LOCK_PC":            {},
	"EMERGENCY_LOCKDOWN": {},
}

var emergencyState struct {
	mu            sync.Mutex
	inProgress    bool
	lastTriggered time.Time
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
	"terminal":     "wt",
	"powershell":   "powershell",
	"cmd":          "cmd",
	"controlpanel": "control",
	"paint":        "mspaint",
	"snippingtool": "snippingtool",
}

func Capabilities() []string {
	return []string{
		"locking",
		"emergency_lockdown",
		"updater",
		"safe_profile_e1",
	}
}

func Execute(deviceID string, version string, command protocol.CommandEnvelope) (result protocol.ResultMessage) {
	result = protocol.ResultMessage{
		Kind:        "result",
		RequestID:   command.RequestID,
		DeviceID:    deviceID,
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
		Version:     version,
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
		return handleErr(fmt.Errorf("%s is disabled in E1 safety profile", commandType), "COMMAND_DISABLED")
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
		if err := signOut(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Sign out started"
		return result
	case "SYSTEM_SHUTDOWN":
		if err := shutdownPC(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Shutdown scheduled (5s)"
		return result
	case "SYSTEM_RESTART":
		if err := restartPC(); err != nil {
			return handleErr(err, "POWER_FAILED")
		}

		result.OK = true
		result.Message = "Restart scheduled (5s)"
		return result
	case "EMERGENCY_LOCKDOWN":
		if err := emergencyLockdown(command.RequestID); err != nil {
			return handleErr(err, "EMERGENCY_FAILED")
		}

		result.OK = true
		result.Message = fmt.Sprintf("Emergency lockdown executed: network blocked with %d-minute failsafe rollback, sync stopped, apps closed, workstation locked", emergencyRollbackMinutes)
		return result
	default:
		return handleErr(fmt.Errorf("unknown command type: %s", command.Type), "UNKNOWN_TYPE")
	}
}

func isEnabledCommandType(commandType string) bool {
	_, ok := enabledCommandTypes[commandType]
	return ok
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

	script := fmt.Sprintf("(New-Object -ComObject WScript.Shell).SendKeys('{%s}')", key)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("send key %s: %w", key, err)
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
	script := fmt.Sprintf("$w = New-Object -ComObject WScript.Shell; $null = $w.Popup('%s', 3, 'Cordyceps E1', 64)", escaped)
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

	escaped := strings.ReplaceAll(text, "'", "''")
	script := fmt.Sprintf("Set-Clipboard -Value '%s'", escaped)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("set clipboard: %w", err)
	}

	return nil
}

func displayOff() error {
	if runtime.GOOS != "windows" {
		return errors.New("SYSTEM_DISPLAY_OFF is supported only on Windows")
	}

	script := "$signature = '[DllImport(\"user32.dll\")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'; Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace E1Agent | Out-Null; [void][E1Agent.NativeMethods]::SendMessage([IntPtr]0xffff, 0x0112, [IntPtr]0xF170, [IntPtr]2)"
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)

	if err := runWithTimeout(cmd, commandTimeout); err != nil {
		return fmt.Errorf("turn display off: %w", err)
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

func emergencyLockdown(requestID string) error {
	if runtime.GOOS != "windows" {
		return errors.New("EMERGENCY_LOCKDOWN is supported only on Windows")
	}

	if err := beginEmergencyLockdown(); err != nil {
		return err
	}
	defer endEmergencyLockdown()

	writeEmergencyAudit(requestID, "started")

	rollbackSeconds := emergencyRollbackMinutes * 60
	script := fmt.Sprintf(`
$ErrorActionPreference = "SilentlyContinue"
$ruleGroup = "E1EmergencyLockdown"
$rollbackSeconds = %d

# Refresh firewall lockdown rules (block all in/out) without mutating long-term defaults.
Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule | Out-Null
New-NetFirewallRule -DisplayName "E1 Emergency Block Outbound" -Group $ruleGroup -Direction Outbound -Action Block -Profile Any -Enabled True | Out-Null
New-NetFirewallRule -DisplayName "E1 Emergency Block Inbound" -Group $ruleGroup -Direction Inbound -Action Block -Profile Any -Enabled True | Out-Null

# Tight isolation: disable active physical adapters right away.
$activeAdapters = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq "Up" })
foreach ($adapter in $activeAdapters) {
  try { Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop | Out-Null } catch {}
}

# Best-effort session disconnect to isolate immediately.
cmd.exe /C "ipconfig /release" | Out-Null

# Drop mapped network drives and SMB shares.
cmd.exe /C "net use * /delete /y" | Out-Null
Get-SmbMapping | ForEach-Object {
  try { Remove-SmbMapping -LocalPath $_.LocalPath -Force -UpdateProfile -ErrorAction Stop | Out-Null } catch {}
}

# Stop common sync clients to reduce spread.
$syncApps = @("OneDrive","Dropbox","GoogleDriveFS","iCloudDrive","iCloudServices","Box","BoxSync","MegaSync","SynologyDrive")
foreach ($name in $syncApps) {
  Get-Process -Name $name | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Close interactive apps but keep shell/system essentials alive.
$safeApps = @("System","Registry","smss","csrss","wininit","services","lsass","winlogon","explorer","ShellExperienceHost","StartMenuExperienceHost","SearchHost","TextInputHost","RuntimeBroker","taskhostw","dwm","ctfmon","conhost","powershell","pwsh","cmd","e1-agent")
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $safeApps -notcontains $_.ProcessName } | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
}

# Failsafe rollback so emergency mode does not permanently lock out networking.
$rollbackCommand = "Start-Sleep -Seconds $rollbackSeconds; Get-NetFirewallRule -Group '$ruleGroup' -ErrorAction SilentlyContinue | Remove-NetFirewallRule | Out-Null; Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Enable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue | Out-Null"
Start-Process -WindowStyle Hidden powershell -ArgumentList @("-NoProfile","-NonInteractive","-WindowStyle","Hidden","-Command",$rollbackCommand) | Out-Null

rundll32.exe user32.dll,LockWorkStation | Out-Null
`, rollbackSeconds)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	if err := runWithTimeout(cmd, emergencyCommandTimeout); err != nil {
		writeEmergencyAudit(requestID, fmt.Sprintf("failed:%v", err))
		return fmt.Errorf("run emergency lockdown: %w", err)
	}

	writeEmergencyAudit(requestID, "completed")
	return nil
}

func beginEmergencyLockdown() error {
	emergencyState.mu.Lock()
	defer emergencyState.mu.Unlock()

	now := time.Now()
	if emergencyState.inProgress {
		return errors.New("emergency lockdown is already running")
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
}

func writeEmergencyAudit(requestID string, status string) {
	programData := strings.TrimSpace(os.Getenv("PROGRAMDATA"))
	if programData == "" {
		return
	}

	auditDir := filepath.Join(programData, "E1Agent")
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
