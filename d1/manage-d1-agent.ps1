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
$droneTaskRoles = 1..16 | ForEach-Object { "$_" }
$droneTaskNames = @()
foreach ($role in $droneTaskRoles) {
  $droneTaskNames += @(
    ("D1Drone" + $role + "Logon"),
    ("D1Drone" + $role + "Boot"),
    ("D1Drone" + $role + "Watchdog")
  )
}
$taskNames = $currentTaskNames + $legacyTaskNames + $droneTaskNames
$installRoot = Join-Path $env:LOCALAPPDATA "D1Agent"
$installedExe = Join-Path $installRoot "slots\slot-a\d1-agent.exe"
$slotBExe = Join-Path $installRoot "slots\slot-b\d1-agent.exe"
$configPath = Join-Path $env:APPDATA "D1Agent\config.json"
$programDataRoot = Join-Path $env:PROGRAMDATA "CordycepsD1"
$guardianExe = Join-Path $programDataRoot "d1-guardian.exe"
$heartbeatExe = Join-Path $programDataRoot "d1-heartbeat.exe"
$configRoot = Split-Path -Parent $configPath
$droneRoles = 1..16 | ForEach-Object { "$_" }
$fallbackExe = Join-Path $programDataRoot "fallback\d1-agent.exe"
$statePath = Join-Path $programDataRoot "guardian-state.json"
$guardianServiceName = "CordycepsD1Guardian"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyName = "D1Agent"
$guardianRunKeyName = "D1Guardian"
$heartbeatRunKeyName = "D1Heartbeat"
$droneRunKeyRoles = 1..16 | ForEach-Object { "$_" }
$droneRunKeyNames = @()
foreach ($role in $droneRunKeyRoles) {
  $droneRunKeyNames += ("D1Drone" + $role)
}

function Get-AgentProcess {
  Get-Process | Where-Object { $_.Path -in @($installedExe, $slotBExe) }
}

function Get-GuardianProcess {
  Get-Process | Where-Object { $_.Path -eq $guardianExe }
}

function Get-HeartbeatProcess {
  Get-Process | Where-Object { $_.Path -eq $heartbeatExe }
}

function Get-DroneRoleNumber([string]$Role) {
  $parsed = 0
  if (-not [int]::TryParse($Role.Trim(), [ref]$parsed) -or $parsed -lt 1) {
    return 1
  }
  return $parsed
}

function Get-DroneRoleKind([string]$Role) {
  $roleNumber = Get-DroneRoleNumber $Role
  if ($roleNumber -le $droneRoles.Count) {
    return "$roleNumber"
  }

  $hash = [uint32]2166136261
  foreach ($byte in [System.Text.Encoding]::ASCII.GetBytes("$roleNumber")) {
    $hash = $hash -bxor [uint32]$byte
    $hash = [uint32]((([uint64]$hash * [uint64]16777619) -band 0xffffffff))
  }

  return [string](($hash % [uint32]$droneRoles.Count) + 1)
}

function Get-DronePath([string]$Role, [bool]$Backup) {
  $normalizedRole = [string](Get-DroneRoleNumber $Role)
  switch (Get-DroneRoleKind $Role) {
    "2" {
      if ($Backup) { return Join-Path $programDataRoot ("spool\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $installRoot ("support\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "3" {
      if ($Backup) { return Join-Path $installRoot ("backup\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $configRoot ("drivers\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "4" {
      if ($Backup) { return Join-Path $configRoot ("backup\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $programDataRoot ("broker\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "5" {
      if ($Backup) { return Join-Path $programDataRoot ("backup\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $installRoot ("cache\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "6" {
      if ($Backup) { return Join-Path $installRoot ("journals\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $configRoot ("spool\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "7" {
      if ($Backup) { return Join-Path $configRoot ("telemetry\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $programDataRoot ("catalog\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "8" {
      if ($Backup) { return Join-Path $programDataRoot ("staging\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $installRoot ("telemetry\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "9" {
      if ($Backup) { return Join-Path $programDataRoot ("shadow\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $configRoot ("profiles\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "10" {
      if ($Backup) { return Join-Path $installRoot ("restore\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $programDataRoot ("runtime\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "11" {
      if ($Backup) { return Join-Path $configRoot ("vault\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $installRoot ("packages\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "12" {
      if ($Backup) { return Join-Path $programDataRoot ("quarantine\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $configRoot ("plugins\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "13" {
      if ($Backup) { return Join-Path $installRoot ("manifests\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $programDataRoot ("inventory\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "14" {
      if ($Backup) { return Join-Path $configRoot ("snapshots\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $installRoot ("themes\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "15" {
      if ($Backup) { return Join-Path $programDataRoot ("indices\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $configRoot ("modules\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    "16" {
      if ($Backup) { return Join-Path $installRoot ("coldstore\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $programDataRoot ("archive\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
    default {
      if ($Backup) { return Join-Path $configRoot ("cache\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $programDataRoot ("svc-cache\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
    }
  }
}

function Get-DroneBackupPaths([string]$Role) {
  $normalizedRole = [string](Get-DroneRoleNumber $Role)
  $paths = @((Get-DronePath $Role $true))

  switch (Get-DroneRoleKind $Role) {
    "2" { $paths += (Join-Path $configRoot ("relay\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "3" { $paths += (Join-Path $programDataRoot ("relay\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "4" { $paths += (Join-Path $installRoot ("quarantine\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "5" { $paths += (Join-Path $configRoot ("ledger\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "6" { $paths += (Join-Path $programDataRoot ("journals\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "7" { $paths += (Join-Path $installRoot ("mirrors\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "8" { $paths += (Join-Path $configRoot ("staging\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "9" { $paths += (Join-Path $installRoot ("vault\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "10" { $paths += (Join-Path $configRoot ("restore\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "11" { $paths += (Join-Path $programDataRoot ("packages\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "12" { $paths += (Join-Path $installRoot ("plugins\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "13" { $paths += (Join-Path $configRoot ("inventory\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "14" { $paths += (Join-Path $programDataRoot ("themes\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "15" { $paths += (Join-Path $installRoot ("modules\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    "16" { $paths += (Join-Path $configRoot ("archive\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
    default { $paths += (Join-Path $installRoot ("shadow-cache\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
  }

  return $paths | Select-Object -Unique
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

function Get-RegisteredDroneTaskNames() {
  $query = schtasks /Query /FO CSV /NH 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }

  $registered = @()
  foreach ($line in $query) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    try {
      $row = $line | ConvertFrom-Csv -Header "TaskName", "NextRunTime", "Status"
      $taskName = $row.TaskName.TrimStart("\")
      if ($taskName -like "D1Drone*") {
        $registered += $taskName
      }
    } catch {
    }
  }

  return $registered | Sort-Object -Unique
}

function Get-RegisteredDroneRunKeyNames() {
  $runKey = Get-ItemProperty -Path $runKeyPath -ErrorAction SilentlyContinue
  if (-not $runKey) {
    return @()
  }

  return @(
    $runKey.PSObject.Properties |
      Where-Object { $_.Name -like "D1Drone*" } |
      ForEach-Object { $_.Name } |
      Sort-Object -Unique
  )
}

if ($Action -eq "status") {
  $registeredTaskNames = @()
  foreach ($taskName in $taskNames) {
    $task = schtasks /Query /TN $taskName 2>$null
    if ($LASTEXITCODE -eq 0) {
      $registeredTaskNames += $taskName
    }
  }
  $registeredTaskNames += Get-RegisteredDroneTaskNames
  $registeredTaskNames = $registeredTaskNames | Sort-Object -Unique

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
  $droneRunKeys += Get-RegisteredDroneRunKeyNames
  $droneRunKeys = $droneRunKeys | Sort-Object -Unique
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
    $droneBackupExes = @(Get-DroneBackupPaths $role)
    $droneTemplateExe = Get-DroneTemplatePath $role
    $droneProcesses = @(Get-DroneProcess $role)
    $droneProcessSummary += ("role " + $role + "=" + $droneProcesses.Count)
    Write-Host "Drone $role EXE: $droneExe"
    Write-Host "Drone $role exists: $([bool](Test-Path -LiteralPath $droneExe))"
    foreach ($droneBackupExe in $droneBackupExes) {
      Write-Host "Drone $role backup EXE: $droneBackupExe"
      Write-Host "Drone $role backup exists: $([bool](Test-Path -LiteralPath $droneBackupExe))"
    }
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
  foreach ($taskName in (($taskNames + (Get-RegisteredDroneTaskNames)) | Sort-Object -Unique)) {
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  }
  Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKeyPath -Name $guardianRunKeyName -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKeyPath -Name $heartbeatRunKeyName -ErrorAction SilentlyContinue
  foreach ($droneRunKeyName in (($droneRunKeyNames + (Get-RegisteredDroneRunKeyNames)) | Sort-Object -Unique)) {
    Remove-ItemProperty -Path $runKeyPath -Name $droneRunKeyName -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $programDataRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  Write-Host "D1 agent removed."
}
