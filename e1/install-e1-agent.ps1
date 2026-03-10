param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$AgentExePath = ".\e1-agent.exe",

  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AgentExePath)) {
  throw "Agent executable not found at '$AgentExePath'. Build or copy e1-agent.exe first."
}

$installRoot = Join-Path $env:LOCALAPPDATA "E1Agent"
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

$installedExe = Join-Path $installRoot "e1-agent.exe"
Copy-Item -LiteralPath $AgentExePath -Destination $installedExe -Force

$args = @(
  "--server-url", $ServerUrl,
  "--bootstrap-token", $BootstrapToken,
  "--run-agent"
)

if ($DeviceId.Trim().Length -gt 0) {
  $args += @("--device-id", $DeviceId.Trim())
}

if ($Foreground.IsPresent) {
  $args += "--foreground"
}

Write-Host "Starting E1 agent enrollment..."
Write-Host "Binary: $installedExe"

if ($Foreground.IsPresent) {
  $args = $args | Where-Object { $_ -ne "--run-agent" }
  Start-Process -FilePath $installedExe -ArgumentList $args
} else {
  Start-Process -FilePath $installedExe -ArgumentList $args -WindowStyle Hidden
}

Write-Host "Done. Agent started."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: e1, e2, ...)."
Write-Host "Config path: $env:APPDATA\E1Agent\config.json"
