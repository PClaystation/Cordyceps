param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$DeviceId = "",

  [string]$AgentExePath = ".\t1-agent.exe",

  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AgentExePath)) {
  throw "Agent executable not found at '$AgentExePath'. Build or copy t1-agent.exe first."
}

$installRoot = Join-Path $env:LOCALAPPDATA "T1Agent"
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

$installedExe = Join-Path $installRoot "t1-agent.exe"
Copy-Item -LiteralPath $AgentExePath -Destination $installedExe -Force

$args = @(
  "--server-url", $ServerUrl,
  "--bootstrap-token", $BootstrapToken
)

if ($DeviceId.Trim().Length -gt 0) {
  $args += @("--device-id", $DeviceId.Trim())
}

if ($Foreground.IsPresent) {
  $args += "--foreground"
}

Write-Host "Starting T1 agent enrollment..."
Write-Host "Binary: $installedExe"

Start-Process -FilePath $installedExe -ArgumentList $args

Write-Host "Done. Agent started."
Write-Host "If DeviceId was omitted, the server auto-designates (for example: t1, t2, ...)."
Write-Host "Config path: $env:APPDATA\T1Agent\config.json"
