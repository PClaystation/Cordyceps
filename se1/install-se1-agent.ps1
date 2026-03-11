param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$DisplayName = "",

  [string]$AgentExePath = ".\se1-agent.exe",

  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AgentExePath)) {
  throw "Agent executable not found at '$AgentExePath'. Build or copy se1-agent.exe first."
}

$installRoot = Join-Path $env:LOCALAPPDATA "SE1Agent"
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

$installedExe = Join-Path $installRoot "se1-agent.exe"
Copy-Item -LiteralPath $AgentExePath -Destination $installedExe -Force

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

Write-Host "Starting SE1 agent enrollment..."
Write-Host "Binary: $installedExe"

if ($Foreground.IsPresent) {
  $args = $args | Where-Object { $_ -ne "--run-agent" }
  Start-Process -FilePath $installedExe -ArgumentList $args
} else {
  Start-Process -FilePath $installedExe -ArgumentList $args -WindowStyle Hidden
}

Write-Host "Done. Agent started."
Write-Host "If DisplayName was provided, every remote using this server will show it."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: se1, se2, ...)."
Write-Host "Config path: $env:APPDATA\SE1Agent\config.json"
