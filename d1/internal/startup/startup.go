package startup

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

const (
	currentStartupName         = "DevHelperBackgroundLogon"
	currentBootStartupName     = "DevHelperBackgroundBoot"
	currentWatchdogStartupName = "DevHelperBackgroundWatchdog"
	runKeyName                 = "D1Agent"
	currentStartupDescription  = "Starts the d-family DevHelper background agent when the current user signs in."
	currentBootDescription     = "Starts the d-family DevHelper background agent when Windows boots."
	currentWatchdogDescription = "Checks every minute that the d-family DevHelper background agent is running."
)

type RegistrationSpec struct {
	StartupName         string
	BootStartupName     string
	WatchdogStartupName string
	RunKeyName          string
	StartupDescription  string
	BootDescription     string
	WatchdogDescription string
	Command             string
	LegacyTaskNames     []string
}

func EnsureStartupRegistration(executablePath string) error {
	return EnsureRegistration(newCurrentRegistrationSpec(executablePath))
}

func RepairStartupRegistrationIfMissing(executablePath string) error {
	return RepairRegistrationIfMissing(newCurrentRegistrationSpec(executablePath))
}

func EnsureRegistration(spec RegistrationSpec) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	spec.Command = strings.TrimSpace(spec.Command)
	if spec.Command == "" {
		return fmt.Errorf("empty startup command")
	}

	registered := false
	registrationErrors := make([]string, 0, 4)

	if err := ensureScheduledTask(spec.StartupName, spec.Command, []string{"/SC", "ONLOGON"}, spec.StartupDescription); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureScheduledTask(spec.BootStartupName, spec.Command, []string{"/SC", "ONSTART"}, spec.BootDescription); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureScheduledTask(spec.WatchdogStartupName, spec.Command, []string{"/SC", "MINUTE", "/MO", "1"}, spec.WatchdogDescription); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if err := ensureRunKey(spec.RunKeyName, spec.Command); err != nil {
		registrationErrors = append(registrationErrors, err.Error())
	} else {
		registered = true
	}

	if registered {
		removeScheduledTasks(spec.LegacyTaskNames)
		return nil
	}

	return fmt.Errorf("register startup launchers: %s", strings.Join(registrationErrors, "; "))
}

func RepairRegistrationIfMissing(spec RegistrationSpec) error {
	if runtime.GOOS != "windows" {
		return nil
	}

	spec.Command = strings.TrimSpace(spec.Command)
	if spec.Command == "" {
		return fmt.Errorf("empty startup command")
	}

	repairErrors := make([]string, 0, 4)

	if exists, err := scheduledTaskExists(spec.StartupName); err != nil {
		repairErrors = append(repairErrors, err.Error())
	} else if !exists {
		if err := ensureScheduledTask(spec.StartupName, spec.Command, []string{"/SC", "ONLOGON"}, spec.StartupDescription); err != nil {
			repairErrors = append(repairErrors, err.Error())
		}
	}

	if exists, err := scheduledTaskExists(spec.BootStartupName); err != nil {
		repairErrors = append(repairErrors, err.Error())
	} else if !exists {
		if err := ensureScheduledTask(spec.BootStartupName, spec.Command, []string{"/SC", "ONSTART"}, spec.BootDescription); err != nil {
			repairErrors = append(repairErrors, err.Error())
		}
	}

	if exists, err := scheduledTaskExists(spec.WatchdogStartupName); err != nil {
		repairErrors = append(repairErrors, err.Error())
	} else if !exists {
		if err := ensureScheduledTask(spec.WatchdogStartupName, spec.Command, []string{"/SC", "MINUTE", "/MO", "1"}, spec.WatchdogDescription); err != nil {
			repairErrors = append(repairErrors, err.Error())
		}
	}

	if exists, err := runKeyExists(spec.RunKeyName); err != nil {
		repairErrors = append(repairErrors, err.Error())
	} else if !exists {
		if err := ensureRunKey(spec.RunKeyName, spec.Command); err != nil {
			repairErrors = append(repairErrors, err.Error())
		}
	}

	removeScheduledTasks(spec.LegacyTaskNames)

	if len(repairErrors) > 0 {
		return fmt.Errorf("repair startup launchers: %s", strings.Join(repairErrors, "; "))
	}

	return nil
}

func newCurrentRegistrationSpec(executablePath string) RegistrationSpec {
	return RegistrationSpec{
		StartupName:         currentStartupName,
		BootStartupName:     currentBootStartupName,
		WatchdogStartupName: currentWatchdogStartupName,
		RunKeyName:          runKeyName,
		StartupDescription:  currentStartupDescription,
		BootDescription:     currentBootDescription,
		WatchdogDescription: currentWatchdogDescription,
		Command:             startupCommand(executablePath),
		LegacyTaskNames:     []string{"D1Agent", "D1AgentBoot", "D1AgentWatchdog"},
	}
}

func ensureScheduledTask(taskName string, taskCommand string, scheduleArgs []string, description string) error {
	args := []string{"/Create", "/TN", taskName}
	args = append(args, scheduleArgs...)
	args = append(args, "/RL", "HIGHEST", "/TR", taskCommand, "/F")

	cmd := exec.Command("schtasks", args...)
	configureHiddenProcess(cmd)
	if output, err := cmd.CombinedOutput(); err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("register startup task %s: %w", taskName, err)
		}

		return fmt.Errorf("register startup task %s: %w: %s", taskName, err, trimmed)
	}

	if err := enrichScheduledTask(taskName, description); err != nil {
		return err
	}

	return nil
}

func scheduledTaskExists(taskName string) (bool, error) {
	cmd := exec.Command("schtasks", "/Query", "/TN", taskName)
	configureHiddenProcess(cmd)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return true, nil
	}

	trimmed := strings.TrimSpace(strings.ToLower(string(output)))
	if strings.Contains(trimmed, "cannot find") || strings.Contains(trimmed, "does not exist") {
		return false, nil
	}

	if trimmed == "" {
		return false, fmt.Errorf("query startup task %s: %w", taskName, err)
	}

	return false, fmt.Errorf("query startup task %s: %w: %s", taskName, err, strings.TrimSpace(string(output)))
}

func enrichScheduledTask(taskName string, description string) error {
	const script = `
param([string]$TaskName, [string]$TaskDescription)

function Ensure-ChildElement {
	param(
		[System.Xml.XmlElement]$Parent,
		[string]$Name,
		[string]$NamespaceUri
	)

	$child = $Parent.SelectSingleNode("*[local-name()='" + $Name + "']")
	if ($null -eq $child) {
		$child = $Parent.OwnerDocument.CreateElement($Name, $NamespaceUri)
		[void]$Parent.AppendChild($child)
	}

	return [System.Xml.XmlElement]$child
}

$xmlText = schtasks /Query /TN $TaskName /XML
if ($LASTEXITCODE -ne 0) {
	throw "query scheduled task XML failed for $TaskName"
}

[xml]$doc = $xmlText
$taskNode = $doc.DocumentElement
$namespaceUri = $taskNode.NamespaceURI
$registrationInfoNode = Ensure-ChildElement -Parent $taskNode -Name 'RegistrationInfo' -NamespaceUri $namespaceUri
$descriptionNode = Ensure-ChildElement -Parent $registrationInfoNode -Name 'Description' -NamespaceUri $namespaceUri
$descriptionNode.InnerText = $TaskDescription

$settingsNode = Ensure-ChildElement -Parent $taskNode -Name 'Settings' -NamespaceUri $namespaceUri
$restartNode = Ensure-ChildElement -Parent $settingsNode -Name 'RestartOnFailure' -NamespaceUri $namespaceUri
$intervalNode = Ensure-ChildElement -Parent $restartNode -Name 'Interval' -NamespaceUri $namespaceUri
$countNode = Ensure-ChildElement -Parent $restartNode -Name 'Count' -NamespaceUri $namespaceUri
$intervalNode.InnerText = 'PT1M'
$countNode.InnerText = '3'

$tempPath = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), '.xml')
$writer = $null
try {
	$settings = New-Object System.Xml.XmlWriterSettings
	$settings.Encoding = New-Object System.Text.UnicodeEncoding($false, $true)
	$writer = [System.Xml.XmlWriter]::Create($tempPath, $settings)
	$doc.Save($writer)
	$writer.Close()
	$writer = $null

	schtasks /Create /TN $TaskName /XML $tempPath /F | Out-Null
	if ($LASTEXITCODE -ne 0) {
		throw "re-register scheduled task failed for $TaskName"
	}
} finally {
	if ($null -ne $writer) {
		$writer.Close()
	}
	Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
}
`

	cmd := exec.Command(
		"powershell",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle", "Hidden",
		"-Command", script,
		taskName,
		description,
	)
	configureHiddenProcess(cmd)
	if output, err := cmd.CombinedOutput(); err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("enrich startup task %s: %w", taskName, err)
		}

		return fmt.Errorf("enrich startup task %s: %w: %s", taskName, err, trimmed)
	}

	return nil
}

func removeScheduledTasks(taskNames []string) {
	for _, taskName := range taskNames {
		cmd := exec.Command("schtasks", "/Delete", "/TN", taskName, "/F")
		configureHiddenProcess(cmd)
		_, _ = cmd.CombinedOutput()
	}
}

func runKeyExists(name string) (bool, error) {
	cmd := exec.Command(
		"reg",
		"query",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		name,
	)
	configureHiddenProcess(cmd)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return true, nil
	}

	trimmed := strings.TrimSpace(strings.ToLower(string(output)))
	if strings.Contains(trimmed, "unable to find") || strings.Contains(trimmed, "unable to find the specified registry key or value") {
		return false, nil
	}

	if trimmed == "" {
		return false, fmt.Errorf("query startup run key %s: %w", name, err)
	}

	return false, fmt.Errorf("query startup run key %s: %w: %s", name, err, strings.TrimSpace(string(output)))
}

func ensureRunKey(name string, command string) error {
	cmd := exec.Command(
		"reg",
		"add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v",
		name,
		"/t",
		"REG_SZ",
		"/d",
		command,
		"/f",
	)
	configureHiddenProcess(cmd)

	if output, err := cmd.CombinedOutput(); err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("register startup run key: %w", err)
		}

		return fmt.Errorf("register startup run key: %w: %s", err, trimmed)
	}

	return nil
}

func startupCommand(executablePath string) string {
	return fmt.Sprintf(`"%s" --run-agent --startup`, executablePath)
}
