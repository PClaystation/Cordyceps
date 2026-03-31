param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$DisplayName = "",

  [string]$AgentExePath = "",

  [string]$GuardianExePath = "",

  [string]$HeartbeatExePath = "",

  [string]$DroneExePath = "",

  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

function Resolve-AgentExePath([string]$requestedPath, [string]$scriptRoot, [string]$defaultExeName) {
  $candidates = @()
  $trimmedPath = $requestedPath.Trim()

  if (-not [string]::IsNullOrWhiteSpace($trimmedPath)) {
    if ([System.IO.Path]::IsPathRooted($trimmedPath)) {
      $candidates += $trimmedPath
    } else {
      $candidates += (Join-Path (Get-Location).Path $trimmedPath)
      $candidates += (Join-Path $scriptRoot $trimmedPath)
    }
  } else {
    $usbName = $defaultExeName -replace "\.exe$", "-usb.exe"
    $candidates += (Join-Path $scriptRoot $defaultExeName)
    $candidates += (Join-Path $scriptRoot (Join-Path "dist" $usbName))
    $candidates += (Join-Path $scriptRoot (Join-Path "dist" $defaultExeName))
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($trimmedPath)) {
    throw "Agent executable not found. Checked path '$trimmedPath' from current directory and script directory."
  }

  throw "Agent executable not found. Build or copy d1-agent.exe (or dist\\d1-agent-usb.exe) first."
}

function Resolve-DroneRoleExePath([string]$requestedPath, [string]$scriptRoot, [string]$role) {
  $trimmedPath = $requestedPath.Trim()
  if (-not [string]::IsNullOrWhiteSpace($trimmedPath)) {
    return Resolve-AgentExePath -requestedPath $trimmedPath -scriptRoot $scriptRoot -defaultExeName ("d1-drone-" + $role + ".exe")
  }

  $candidates = @(
    (Join-Path $scriptRoot ("d1-drone-" + $role + ".exe")),
    (Join-Path $scriptRoot (Join-Path "dist" ("d1-drone-" + $role + ".exe"))),
    (Join-Path $scriptRoot "d1-drone.exe"),
    (Join-Path $scriptRoot (Join-Path "dist" "d1-drone.exe"))
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  throw ("Drone executable for role " + $role + " not found. Build the role-specific restore drones first.")
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedAgentExePath = Resolve-AgentExePath -requestedPath $AgentExePath -scriptRoot $scriptRoot -defaultExeName "d1-agent.exe"

$resolvedGuardianExePath = Resolve-AgentExePath -requestedPath $GuardianExePath -scriptRoot $scriptRoot -defaultExeName "d1-guardian.exe"

$resolvedHeartbeatExePath = Resolve-AgentExePath -requestedPath $HeartbeatExePath -scriptRoot $scriptRoot -defaultExeName "d1-heartbeat.exe"
$droneRoles = 1..16 | ForEach-Object { "$_" }
$resolvedDroneExePaths = @{}
foreach ($role in $droneRoles) {
  $resolvedDroneExePaths[$role] = Resolve-DroneRoleExePath -requestedPath $DroneExePath -scriptRoot $scriptRoot -role $role
}

$installRoot = Join-Path $env:LOCALAPPDATA "D1Agent"
$programDataRoot = Join-Path $env:PROGRAMDATA "CordycepsD1"
$slotRoot = Join-Path $installRoot "slots\slot-a"
$configPath = Join-Path $env:APPDATA "D1Agent\config.json"
$configRoot = Split-Path -Parent $configPath

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
      if ($Backup) { return Join-Path $configRoot ("cache\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe") }
      return Join-Path $installRoot ("tools\mesh-" + $normalizedRole + "\d1-drone-" + $normalizedRole + ".exe")
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
    "4" { $paths += (Join-Path $installRoot ("staging\mesh-" + $normalizedRole + "-backup\d1-drone-" + $normalizedRole + ".exe")) }
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

New-Item -ItemType Directory -Path $slotRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $programDataRoot "fallback") -Force | Out-Null

$installedExe = Join-Path $slotRoot "d1-agent.exe"
$fallbackExe = Join-Path $programDataRoot "fallback\d1-agent.exe"
$installedGuardian = Join-Path $programDataRoot "d1-guardian.exe"
$installedHeartbeat = Join-Path $programDataRoot "d1-heartbeat.exe"

Copy-Item -LiteralPath $resolvedAgentExePath -Destination $installedExe -Force
Copy-Item -LiteralPath $resolvedAgentExePath -Destination $fallbackExe -Force
Copy-Item -LiteralPath $resolvedGuardianExePath -Destination $installedGuardian -Force
Copy-Item -LiteralPath $resolvedHeartbeatExePath -Destination $installedHeartbeat -Force
foreach ($role in $droneRoles) {
  $installedDrone = Get-DronePath $role $false
  $backupDrones = @(Get-DroneBackupPaths $role)
  $templateDrone = Get-DroneTemplatePath $role
  New-Item -ItemType Directory -Path (Split-Path -Parent $installedDrone) -Force | Out-Null
  foreach ($backupDrone in $backupDrones) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupDrone) -Force | Out-Null
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $templateDrone) -Force | Out-Null
  Copy-Item -LiteralPath $resolvedDroneExePaths[$role] -Destination $installedDrone -Force
  foreach ($backupDrone in $backupDrones) {
    Copy-Item -LiteralPath $resolvedDroneExePaths[$role] -Destination $backupDrone -Force
  }
  Copy-Item -LiteralPath $resolvedDroneExePaths[$role] -Destination $templateDrone -Force
}

$coldSparePath = Get-DroneColdSparePath
New-Item -ItemType Directory -Path (Split-Path -Parent $coldSparePath) -Force | Out-Null
Copy-Item -LiteralPath $resolvedDroneExePaths["1"] -Destination $coldSparePath -Force

$trustedHashes = @()
foreach ($role in $droneRoles) {
  $trustedHashes += (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedDroneExePaths[$role]).Hash.ToLowerInvariant()
}
$trustedHashes = $trustedHashes | Sort-Object -Unique
$trustManifest = @{
  version = "0.1.0"
  updated_at = (Get-Date).ToUniversalTime().ToString("o")
  trusted_sha256 = $trustedHashes
} | ConvertTo-Json -Depth 4

foreach ($manifestPath in (Get-DroneManifestPaths)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $manifestPath) -Force | Out-Null
  Set-Content -LiteralPath $manifestPath -Value $trustManifest -Encoding UTF8
}

$guardianArgs = @(
  "--config", $configPath,
  "--install-root", $installRoot,
  "--program-data-root", $programDataRoot,
  "--startup"
)

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
$guardianServiceInstalled = $false

$heartbeatArgs = @(
  "--config", $configPath,
  "--startup"
)

$args = @(
  "--server-url", $ServerUrl,
  "--bootstrap-token", $BootstrapToken,
  "--config", $configPath,
  "--install-root", $installRoot,
  "--program-data-root", $programDataRoot,
  "--slot", "a",
  "--run-agent"
)

if ($DeviceId.Trim().Length -gt 0) {
  $args += @("--device-id", $DeviceId.Trim())
}

if ($DisplayName.Trim().Length -gt 0) {
  $args += @("--display-name", $DisplayName.Trim())
}

if ($Foreground.IsPresent) {
  $args += "--foreground"
}

Write-Host "Starting D1 agent enrollment..."
Write-Host "Binary: $installedExe"
Write-Host "Guardian: $installedGuardian"
Write-Host "Heartbeat companion: $installedHeartbeat"
Write-Host "Restore drones: distributed across ProgramData, LocalAppData, and AppData roots"

if ($isAdmin) {
  & $installedGuardian @($guardianArgs + "--install")
  if ($LASTEXITCODE -eq 0) {
    $guardianServiceInstalled = $true
    Start-Service -Name "CordycepsD1Guardian" -ErrorAction SilentlyContinue
  }
}

if ($Foreground.IsPresent) {
  $args = $args | Where-Object { $_ -ne "--run-agent" }
  Start-Process -FilePath $installedExe -ArgumentList $args
  Start-Process -FilePath $installedHeartbeat -ArgumentList $heartbeatArgs
} else {
  if (-not $guardianServiceInstalled) {
    Start-Process -FilePath $installedGuardian -ArgumentList $guardianArgs -WindowStyle Hidden
  }
  Start-Process -FilePath $installedHeartbeat -ArgumentList $heartbeatArgs -WindowStyle Hidden
}

foreach ($role in $droneRoles) {
  $installedDrone = Get-DronePath $role $false
  $droneArgs = @(
    "--config", $configPath,
    "--install-root", $installRoot,
    "--program-data-root", $programDataRoot,
    "--role", $role
  )
  if ($Foreground.IsPresent) {
    Start-Process -FilePath $installedDrone -ArgumentList $droneArgs
  } else {
    Start-Process -FilePath $installedDrone -ArgumentList $droneArgs -WindowStyle Hidden
  }
}

Write-Host "Done. Agent started."
if (-not $isAdmin) {
  Write-Host "Guardian service was not installed because this shell is not elevated. Guardian still runs via hidden startup persistence."
}
Write-Host "If DisplayName was provided, every remote using this server will show it."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: d1, d2, ...)."
Write-Host "Config path: $configPath"
