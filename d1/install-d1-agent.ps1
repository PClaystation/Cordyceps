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
$resolvedDroneExePaths = @{}
foreach ($role in @("1", "2", "3", "4", "5")) {
  $resolvedDroneExePaths[$role] = Resolve-DroneRoleExePath -requestedPath $DroneExePath -scriptRoot $scriptRoot -role $role
}

$installRoot = Join-Path $env:LOCALAPPDATA "D1Agent"
$programDataRoot = Join-Path $env:PROGRAMDATA "CordycepsD1"
$slotRoot = Join-Path $installRoot "slots\slot-a"
$configPath = Join-Path $env:APPDATA "D1Agent\config.json"
$configRoot = Split-Path -Parent $configPath

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
foreach ($role in @("1", "2", "3", "4", "5")) {
  $installedDrone = Get-DronePath $role $false
  $backupDrone = Get-DronePath $role $true
  $templateDrone = Get-DroneTemplatePath $role
  New-Item -ItemType Directory -Path (Split-Path -Parent $installedDrone) -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $backupDrone) -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $templateDrone) -Force | Out-Null
  Copy-Item -LiteralPath $resolvedDroneExePaths[$role] -Destination $installedDrone -Force
  Copy-Item -LiteralPath $resolvedDroneExePaths[$role] -Destination $backupDrone -Force
  Copy-Item -LiteralPath $resolvedDroneExePaths[$role] -Destination $templateDrone -Force
}

$coldSparePath = Get-DroneColdSparePath
New-Item -ItemType Directory -Path (Split-Path -Parent $coldSparePath) -Force | Out-Null
Copy-Item -LiteralPath $resolvedDroneExePaths["1"] -Destination $coldSparePath -Force

$trustedHashes = @()
foreach ($role in @("1", "2", "3", "4", "5")) {
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

foreach ($role in @("1", "2", "3", "4", "5")) {
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
