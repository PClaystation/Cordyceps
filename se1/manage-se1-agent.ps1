param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("status", "uninstall")]
  [string]$Action
)

$ErrorActionPreference = "Stop"

$taskName = "SE1Agent"
$installRoot = Join-Path $env:LOCALAPPDATA "SE1Agent"
$installedExe = Join-Path $installRoot "se1-agent.exe"
$configPath = Join-Path $env:APPDATA "SE1Agent\config.json"
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyName = "SE1Agent"

function Get-AgentProcess {
  Get-Process | Where-Object { $_.Path -eq $installedExe }
}

if ($Action -eq "status") {
  $task = schtasks /Query /TN $taskName 2>$null
  $taskRegistered = $LASTEXITCODE -eq 0
  $runKey = Get-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  $processes = @(Get-AgentProcess)

  Write-Host "Installed EXE: $installedExe"
  Write-Host "Installed: $([bool](Test-Path -LiteralPath $installedExe))"
  Write-Host "Config path: $configPath"
  Write-Host "Config exists: $([bool](Test-Path -LiteralPath $configPath))"
  Write-Host "Scheduled task registered: $taskRegistered"
  Write-Host "Run key registered: $([bool]$runKey)"
  Write-Host "Running processes: $($processes.Count)"

  if (Test-Path -LiteralPath $configPath) {
    Write-Host ""
    Write-Host "Config:"
    Get-Content -LiteralPath $configPath
  }

  exit 0
}

if ($Action -eq "uninstall") {
  Get-AgentProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $installedExe -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  Write-Host "SE1 agent removed."
}
