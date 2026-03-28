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
$droneTaskNames = @(
  "D1Drone1Logon",
  "D1Drone1Boot",
  "D1Drone1Watchdog",
  "D1Drone3Logon",
  "D1Drone3Boot",
  "D1Drone3Watchdog",
  "D1Drone4Logon",
  "D1Drone4Boot",
  "D1Drone4Watchdog",
  "D1Drone5Logon",
  "D1Drone5Boot",
  "D1Drone5Watchdog"
)
$taskNames = $currentTaskNames + $legacyTaskNames + $droneTaskNames
$installRoot = Join-Path $env:LOCALAPPDATA "D1Agent"
$installedExe = Join-Path $installRoot "slots\slot-a\d1-agent.exe"
$slotBExe = Join-Path $installRoot "slots\slot-b\d1-agent.exe"
$configPath = Join-Path $env:APPDATA "D1Agent\config.json"
$programDataRoot = Join-Path $env:PROGRAMDATA "CordycepsD1"
$guardianExe = Join-Path $programDataRoot "d1-guardian.exe"
$heartbeatExe = Join-Path $programDataRoot "d1-heartbeat.exe"
$configRoot = Split-Path -Parent $configPath
$droneRoles = @("1", "2", "3", "4", "5")
$fallbackExe = Join-Path $programDataRoot "fallback\d1-agent.exe"
$statePath = Join-Path $programDataRoot "guardian-state.json"
$guardianServiceName = "CordycepsD1Guardian"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyName = "D1Agent"
$guardianRunKeyName = "D1Guardian"
$heartbeatRunKeyName = "D1Heartbeat"
$droneRunKeyNames = @("D1Drone1", "D1Drone2", "D1Drone4")

function Get-AgentProcess {
  Get-Process | Where-Object { $_.Path -in @($installedExe, $slotBExe) }
}

function Get-GuardianProcess {
  Get-Process | Where-Object { $_.Path -eq $guardianExe }
}

function Get-HeartbeatProcess {
  Get-Process | Where-Object { $_.Path -eq $heartbeatExe }
}

function Get-DronePath([string]$Role, [bool]$Backup) {
  switch ($Role) {
    "2" {
      if ($Backup) { return Join-Path $programDataRoot "spool\mesh-2-backup\d1-drone-2.exe" }
      return Join-Path $installRoot "support\mesh-2\d1-drone-2.exe"
    }
    "3" {
      if ($Backup) { return Join-Path $installRoot "backup\mesh-3-backup\d1-drone-3.exe" }
      return Join-Path $configRoot "drivers\mesh-3\d1-drone-3.exe"
    }
    "4" {
      if ($Backup) { return Join-Path $configRoot "backup\mesh-4-backup\d1-drone-4.exe" }
      return Join-Path $programDataRoot "broker\mesh-4\d1-drone-4.exe"
    }
    "5" {
      if ($Backup) { return Join-Path $programDataRoot "backup\mesh-5-backup\d1-drone-5.exe" }
      return Join-Path $installRoot "cache\mesh-5\d1-drone-5.exe"
    }
    default {
      if ($Backup) { return Join-Path $configRoot "cache\mesh-1-backup\d1-drone-1.exe" }
      return Join-Path $programDataRoot "svc-cache\mesh-1\d1-drone-1.exe"
    }
  }
}

function Get-DroneTemplatePath([string]$Role) {
  return Join-Path $programDataRoot ("templates\mesh-" + $Role + "\d1-drone-" + $Role + ".exe")
}

function Get-DroneManifestPaths() {
  return @(
    (Join-Path $programDataRoot "manifests\drone-trust.json"),
    (Join-Path $installRoot "cache\drone-trust.json"),
    (Join-Path $configRoot "manifests\drone-trust.json")
  )
}

function Get-DroneColdSparePath() {
  return Join-Path $installRoot "fonts\cache\cold-spare\d1-drone-cold.exe"
}

function Get-DroneProcess([string]$Role) {
  $droneExe = Get-DronePath $Role $false
  Get-Process | Where-Object { $_.Path -eq $droneExe }
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
  $heartbeatRunKey = Get-ItemProperty -Path $runKeyPath -Name $heartbeatRunKeyName -ErrorAction SilentlyContinue
  $droneRunKeys = @()
  foreach ($droneRunKeyName in $droneRunKeyNames) {
    $droneRunKey = Get-ItemProperty -Path $runKeyPath -Name $droneRunKeyName -ErrorAction SilentlyContinue
    if ($droneRunKey) {
      $droneRunKeys += $droneRunKeyName
    }
  }
  $processes = @(Get-AgentProcess)
  $guardianProcesses = @(Get-GuardianProcess)
  $heartbeatProcesses = @(Get-HeartbeatProcess)
  $droneProcessSummary = @()
  $guardianService = Get-Service -Name $guardianServiceName -ErrorAction SilentlyContinue

  Write-Host "Installed EXE: $installedExe"
  Write-Host "Installed: $([bool](Test-Path -LiteralPath $installedExe))"
  Write-Host "Slot B EXE: $slotBExe"
  Write-Host "Slot B exists: $([bool](Test-Path -LiteralPath $slotBExe))"
  Write-Host "Guardian EXE: $guardianExe"
  Write-Host "Guardian exists: $([bool](Test-Path -LiteralPath $guardianExe))"
  Write-Host "Heartbeat EXE: $heartbeatExe"
  Write-Host "Heartbeat exists: $([bool](Test-Path -LiteralPath $heartbeatExe))"
  foreach ($role in $droneRoles) {
    $droneExe = Get-DronePath $role $false
    $droneBackupExe = Get-DronePath $role $true
    $droneTemplateExe = Get-DroneTemplatePath $role
    $droneProcesses = @(Get-DroneProcess $role)
    $droneProcessSummary += ("role " + $role + "=" + $droneProcesses.Count)
    Write-Host "Drone $role EXE: $droneExe"
    Write-Host "Drone $role exists: $([bool](Test-Path -LiteralPath $droneExe))"
    Write-Host "Drone $role backup EXE: $droneBackupExe"
    Write-Host "Drone $role backup exists: $([bool](Test-Path -LiteralPath $droneBackupExe))"
    Write-Host "Drone $role template EXE: $droneTemplateExe"
    Write-Host "Drone $role template exists: $([bool](Test-Path -LiteralPath $droneTemplateExe))"
  }
  $coldSparePath = Get-DroneColdSparePath
  Write-Host "Drone cold spare EXE: $coldSparePath"
  Write-Host "Drone cold spare exists: $([bool](Test-Path -LiteralPath $coldSparePath))"
  foreach ($manifestPath in (Get-DroneManifestPaths)) {
    Write-Host "Drone trust manifest: $manifestPath"
    Write-Host "Drone trust manifest exists: $([bool](Test-Path -LiteralPath $manifestPath))"
  }
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
  Write-Host "Heartbeat run key registered: $([bool]$heartbeatRunKey)"
  Write-Host "Drone run keys registered: $($droneRunKeys -join ', ')"
  Write-Host "Guardian service installed: $([bool]$guardianService)"
  Write-Host "Guardian service status: $($guardianService.Status)"
  Write-Host "Running processes: $($processes.Count)"
  Write-Host "Guardian processes: $($guardianProcesses.Count)"
  Write-Host "Heartbeat processes: $($heartbeatProcesses.Count)"
  Write-Host "Drone processes: $($droneProcessSummary -join ', ')"

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
  Get-HeartbeatProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($role in $droneRoles) {
    Get-DroneProcess $role | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Stop-Service -Name $guardianServiceName -ErrorAction SilentlyContinue
  sc.exe delete $guardianServiceName | Out-Null
  foreach ($taskName in $taskNames) {
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  }
  Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKeyPath -Name $guardianRunKeyName -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKeyPath -Name $heartbeatRunKeyName -ErrorAction SilentlyContinue
  foreach ($droneRunKeyName in $droneRunKeyNames) {
    Remove-ItemProperty -Path $runKeyPath -Name $droneRunKeyName -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $programDataRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  Write-Host "D1 agent removed."
}
