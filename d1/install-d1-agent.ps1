param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$DisplayName = "",

  [string]$AgentExePath = "",

  [string]$GuardianExePath = "",

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

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedAgentExePath = Resolve-AgentExePath -requestedPath $AgentExePath -scriptRoot $scriptRoot -defaultExeName "d1-agent.exe"

$resolvedGuardianExePath = Resolve-AgentExePath -requestedPath $GuardianExePath -scriptRoot $scriptRoot -defaultExeName "d1-guardian.exe"

$installRoot = Join-Path $env:LOCALAPPDATA "D1Agent"
$programDataRoot = Join-Path $env:PROGRAMDATA "CordycepsD1"
$slotRoot = Join-Path $installRoot "slots\slot-a"
$configPath = Join-Path $env:APPDATA "D1Agent\config.json"

New-Item -ItemType Directory -Path $slotRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $programDataRoot "fallback") -Force | Out-Null

$installedExe = Join-Path $slotRoot "d1-agent.exe"
$fallbackExe = Join-Path $programDataRoot "fallback\d1-agent.exe"
$installedGuardian = Join-Path $programDataRoot "d1-guardian.exe"

Copy-Item -LiteralPath $resolvedAgentExePath -Destination $installedExe -Force
Copy-Item -LiteralPath $resolvedAgentExePath -Destination $fallbackExe -Force
Copy-Item -LiteralPath $resolvedGuardianExePath -Destination $installedGuardian -Force

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
} elseif (-not $guardianServiceInstalled) {
  Start-Process -FilePath $installedGuardian -ArgumentList $guardianArgs -WindowStyle Hidden
}

Write-Host "Done. Agent started."
if (-not $isAdmin) {
  Write-Host "Guardian service was not installed because this shell is not elevated. Guardian still runs via hidden startup persistence."
}
Write-Host "If DisplayName was provided, every remote using this server will show it."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: d1, d2, ...)."
Write-Host "Config path: $configPath"
