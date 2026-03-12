param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$DisplayName = "",

  [string]$AgentExePath = "",

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

  throw "Agent executable not found. Build or copy a1-agent.exe (or dist\\a1-agent-usb.exe) first."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedAgentExePath = Resolve-AgentExePath -requestedPath $AgentExePath -scriptRoot $scriptRoot -defaultExeName "a1-agent.exe"

$installRoot = Join-Path $env:LOCALAPPDATA "A1Agent"
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

$installedExe = Join-Path $installRoot "a1-agent.exe"
Copy-Item -LiteralPath $resolvedAgentExePath -Destination $installedExe -Force

$args = @(
  "--server-url", $ServerUrl,
  "--bootstrap-token", $BootstrapToken,
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

Write-Host "Starting A1 agent enrollment..."
Write-Host "Binary: $installedExe"

if ($Foreground.IsPresent) {
  $args = $args | Where-Object { $_ -ne "--run-agent" }
  Start-Process -FilePath $installedExe -ArgumentList $args
} else {
  Start-Process -FilePath $installedExe -ArgumentList $args -WindowStyle Hidden
}

Write-Host "Done. Agent started."
Write-Host "If DisplayName was provided, every remote using this server will show it."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: a1, a2, ...)."
Write-Host "Config path: $env:APPDATA\A1Agent\config.json"
