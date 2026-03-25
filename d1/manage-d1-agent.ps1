param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("status", "uninstall")]
  [string]$Action
)

$ErrorActionPreference = "Stop"

$currentTaskNames = @(
  "DevHelperBackgroundLogon",
  "DevHelperBackgroundBoot",
  "DevHelperBackgroundWatchdog",
  "D1GuardianLogon",
  "D1GuardianBoot",
  "D1GuardianWatchdog"
)
$legacyTaskNames = @("D1Agent", "D1AgentBoot", "D1AgentWatchdog")
$taskNames = $currentTaskNames + $legacyTaskNames
$installRoot = Join-Path $env:LOCALAPPDATA "D1Agent"
$installedExe = Join-Path $installRoot "slots\slot-a\d1-agent.exe"
$slotBExe = Join-Path $installRoot "slots\slot-b\d1-agent.exe"
$configPath = Join-Path $env:APPDATA "D1Agent\config.json"
$programDataRoot = Join-Path $env:PROGRAMDATA "CordycepsD1"
$guardianExe = Join-Path $programDataRoot "d1-guardian.exe"
$fallbackExe = Join-Path $programDataRoot "fallback\d1-agent.exe"
$statePath = Join-Path $programDataRoot "guardian-state.json"
$guardianServiceName = "CordycepsD1Guardian"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyName = "D1Agent"
$guardianRunKeyName = "D1Guardian"

function Get-AgentProcess {
  Get-Process | Where-Object { $_.Path -in @($installedExe, $slotBExe) }
}

function Get-GuardianProcess {
  Get-Process | Where-Object { $_.Path -eq $guardianExe }
}

if ($Action -eq "status") {
  $registeredTaskNames = @()
  foreach ($taskName in $taskNames) {
    $task = schtasks /Query /TN $taskName 2>$null
    if ($LASTEXITCODE -eq 0) {
      $registeredTaskNames += $taskName
    }
  }

  $runKey = Get-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  $guardianRunKey = Get-ItemProperty -Path $runKeyPath -Name $guardianRunKeyName -ErrorAction SilentlyContinue
  $processes = @(Get-AgentProcess)
  $guardianProcesses = @(Get-GuardianProcess)
  $guardianService = Get-Service -Name $guardianServiceName -ErrorAction SilentlyContinue

  Write-Host "Installed EXE: $installedExe"
  Write-Host "Installed: $([bool](Test-Path -LiteralPath $installedExe))"
  Write-Host "Slot B EXE: $slotBExe"
  Write-Host "Slot B exists: $([bool](Test-Path -LiteralPath $slotBExe))"
  Write-Host "Guardian EXE: $guardianExe"
  Write-Host "Guardian exists: $([bool](Test-Path -LiteralPath $guardianExe))"
  Write-Host "Fallback EXE: $fallbackExe"
  Write-Host "Fallback exists: $([bool](Test-Path -LiteralPath $fallbackExe))"
  Write-Host "Guardian state path: $statePath"
  Write-Host "Guardian state exists: $([bool](Test-Path -LiteralPath $statePath))"
  Write-Host "Config path: $configPath"
  Write-Host "Config exists: $([bool](Test-Path -LiteralPath $configPath))"
  Write-Host "Scheduled task registered: $([bool]($registeredTaskNames.Count -gt 0))"
  Write-Host "Scheduled task names: $($registeredTaskNames -join ', ')"
  Write-Host "Run key registered: $([bool]$runKey)"
  Write-Host "Guardian run key registered: $([bool]$guardianRunKey)"
  Write-Host "Guardian service installed: $([bool]$guardianService)"
  Write-Host "Guardian service status: $($guardianService.Status)"
  Write-Host "Running processes: $($processes.Count)"
  Write-Host "Guardian processes: $($guardianProcesses.Count)"

  if (Test-Path -LiteralPath $configPath) {
    Write-Host ""
    Write-Host "Config:"
    Get-Content -LiteralPath $configPath
  }

  exit 0
}

if ($Action -eq "uninstall") {
  Get-AgentProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-GuardianProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-Service -Name $guardianServiceName -ErrorAction SilentlyContinue
  sc.exe delete $guardianServiceName | Out-Null
  foreach ($taskName in $taskNames) {
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  }
  Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKeyPath -Name $guardianRunKeyName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $programDataRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  Write-Host "D1 agent removed."
}
