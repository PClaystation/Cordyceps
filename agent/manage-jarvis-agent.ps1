param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("status", "uninstall")]
  [string]$Action
)

$ErrorActionPreference = "Stop"

$taskNames = @("CordycepsAgent", "CordycepsAgentBoot", "CordycepsAgentWatchdog", "JarvisAgent", "JarvisAgentBoot", "JarvisAgentWatchdog")
$installRoots = @(
  (Join-Path $env:LOCALAPPDATA "CordycepsAgent"),
  (Join-Path $env:LOCALAPPDATA "JarvisAgent")
)
$installedExePaths = @(
  (Join-Path $installRoots[0] "cordyceps-agent.exe"),
  (Join-Path $installRoots[1] "jarvis-agent.exe")
)
$configPaths = @(
  (Join-Path $env:APPDATA "CordycepsAgent\config.json"),
  (Join-Path $env:APPDATA "JarvisAgent\config.json")
)
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runKeyNames = @("CordycepsAgent", "JarvisAgent")

function Get-AgentProcess {
  Get-Process | Where-Object { $installedExePaths -contains $_.Path }
}

if ($Action -eq "status") {
  $taskRegistered = $false
  foreach ($taskName in $taskNames) {
    $task = schtasks /Query /TN $taskName 2>$null
    if ($LASTEXITCODE -eq 0) {
      $taskRegistered = $true
    }
  }

  $runKeyRegistered = $false
  foreach ($runKeyName in $runKeyNames) {
    $runKey = Get-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
    if ($runKey) {
      $runKeyRegistered = $true
    }
  }

  $processes = @(Get-AgentProcess)

  Write-Host "Installed EXE paths: $($installedExePaths -join ', ')"
  Write-Host "Installed: $([bool](@($installedExePaths | Where-Object { Test-Path -LiteralPath $_ }).Count))"
  Write-Host "Config paths: $($configPaths -join ', ')"
  Write-Host "Config exists: $([bool](@($configPaths | Where-Object { Test-Path -LiteralPath $_ }).Count))"
  Write-Host "Scheduled task registered: $taskRegistered"
  Write-Host "Run key registered: $runKeyRegistered"
  Write-Host "Running processes: $($processes.Count)"

  foreach ($configPath in $configPaths) {
    if (Test-Path -LiteralPath $configPath) {
      Write-Host ""
      Write-Host "Config ($configPath):"
      Get-Content -LiteralPath $configPath
    }
  }

  exit 0
}

if ($Action -eq "uninstall") {
  Get-AgentProcess | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($taskName in $taskNames) {
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  }
  foreach ($runKeyName in $runKeyNames) {
    Remove-ItemProperty -Path $runKeyPath -Name $runKeyName -ErrorAction SilentlyContinue
  }
  foreach ($installedExe in $installedExePaths) {
    Remove-Item -LiteralPath $installedExe -Force -ErrorAction SilentlyContinue
  }
  foreach ($configPath in $configPaths) {
    Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Cordyceps agent removed."
}
