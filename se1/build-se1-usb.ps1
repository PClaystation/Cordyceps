param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$OutputPath = ".\dist\se1-agent-usb.exe",

  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $OutputPath))
$outputDir = Split-Path -Parent $outputFullPath

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$ldflags = @(
  "-H=windowsgui",
  "-X", "main.defaultVersion=$Version",
  "-X", "main.defaultServerURL=$ServerUrl",
  "-X", "main.defaultBootstrapToken=$BootstrapToken"
)

$buildArgs = @(
  "build",
  "-trimpath",
  "-ldflags", ($ldflags -join " "),
  "-o", $outputFullPath,
  ".\cmd\se1"
)

Push-Location $scriptRoot
$oldGoos = $env:GOOS
$oldGoarch = $env:GOARCH
$oldCgoEnabled = $env:CGO_ENABLED
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
try {
  & go @buildArgs
  Write-Host "Built USB-ready agent: $outputFullPath"
  Write-Host "Usage on target PC: double-click the EXE once."
}
finally {
  $env:GOOS = $oldGoos
  $env:GOARCH = $oldGoarch
  $env:CGO_ENABLED = $oldCgoEnabled
  Pop-Location
}
