param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$DisplayName = "",

  [string]$AgentExePath = ".\s1-agent.exe",

  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AgentExePath)) {
  throw "Agent executable not found at '$AgentExePath'. Build or copy s1-agent.exe first."
}

$installRoot = Join-Path $env:LOCALAPPDATA "S1Agent"
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

$installedExe = Join-Path $installRoot "s1-agent.exe"
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

Write-Host "Starting S1 agent enrollment..."
Write-Host "Binary: $installedExe"

if ($Foreground.IsPresent) {
  $args = $args | Where-Object { $_ -ne "--run-agent" }
  Start-Process -FilePath $installedExe -ArgumentList $args
} else {
  Start-Process -FilePath $installedExe -ArgumentList $args -WindowStyle Hidden
}

Write-Host "Done. Agent started."
Write-Host "If DisplayName was provided, every remote using this server will show it."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: s1, s2, ...)."
Write-Host "Config path: $env:APPDATA\S1Agent\config.json"
