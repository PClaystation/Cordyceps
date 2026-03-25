param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("status", "uninstall")]
  [string]$Action
)

$ErrorActionPreference = "Stop"

$currentTaskNames = @(
  "DS1AgentLogon",
  "DS1AgentBoot",
  "DS1AgentWatchdog"
)
$legacyTaskNames = @("DS1Agent", "DS1AgentBoot", "DS1AgentWatchdog")
$taskNames = $currentTaskNames + $legacyTaskNames
$installRoot = Join-Path $env:LOCALAPPDATA "DS1Agent"
$installedExe = Join-Path $installRoot "ds1-agent.exe"
$configPath = Join-Path $env:APPDATA "DS1Agent\config.json"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyName = "DS1Agent"

function Get-AgentProcess {
  Get-Process | Where-Object { $_.Path -eq $installedExe }
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
  $processes = @(Get-AgentProcess)

  Write-Host "Installed EXE: $installedExe"
  Write-Host "Installed: $([bool](Test-Path -LiteralPath $installedExe))"
  Write-Host "Config path: $configPath"
  Write-Host "Config exists: $([bool](Test-Path -LiteralPath $configPath))"
  Write-Host "Scheduled task registered: $([bool]($registeredTaskNames.Count -gt 0))"
  Write-Host "Scheduled task names: $($registeredTaskNames -join ', ')"
  Write-Host "Run key registered: $([bool]$runKey)"
  Write-Host "Running processes: $($processes.Count)"

  if (Test-Path -LiteralPath $configPath) {
    Write-Host ""
    Write-Host "Config:"
    Get-Content -LiteralPath $configPath
  }

  exit 0
}

if ($Action -eq "uninstall") {
  Get-AgentProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($taskName in $taskNames) {
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  }
  Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installedExe -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  Write-Host "DS1 agent removed."
}
