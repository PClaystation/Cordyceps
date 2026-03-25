param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$OutputPath = ".\dist\d1-agent-usb.exe",

  [string]$GuardianOutputPath = ".\dist\d1-guardian.exe",

  [string]$Version = "0.1.0",

  [string]$CodeSigningThumbprint = "",

  [string]$CodeSigningPfxPath = "",

  [string]$CodeSigningPfxPassword = "",

  [string]$TimestampUrl = "",

  [switch]$Background,

  [switch]$Startup
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot ".."))
$buildSupportPath = Join-Path $repoRoot "ops/windows-build-support.ps1"
. $buildSupportPath

$outputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $OutputPath))
$guardianOutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $GuardianOutputPath))
$outputDir = Split-Path -Parent $outputFullPath
$guardianOutputDir = Split-Path -Parent $guardianOutputFullPath

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
New-Item -ItemType Directory -Path $guardianOutputDir -Force | Out-Null

$backgroundValue = if ($Background.IsPresent) { "true" } else { "false" }
$startupValue = if ($Startup.IsPresent) { "true" } else { "false" }

$ldflags = @(
  "-H=windowsgui",
  "-X", "main.defaultVersion=$Version",
  "-X", "main.defaultServerURL=$ServerUrl",
  "-X", "main.defaultBootstrapToken=$BootstrapToken",
  "-X", "main.defaultBackgroundMode=$backgroundValue",
  "-X", "main.defaultStartupMode=$startupValue"
)

$buildArgs = @(
  "build",
  "-trimpath",
  "-ldflags", ($ldflags -join " "),
  "-o", $outputFullPath,
  ".\cmd\d1"
)

$guardianLdflags = @(
  "-H=windowsgui",
  "-X", "main.guardianVersion=$Version"
)

$guardianBuildArgs = @(
  "build",
  "-trimpath",
  "-ldflags", ($guardianLdflags -join " "),
  "-o", $guardianOutputFullPath,
  ".\cmd\d1guardian"
)

Push-Location $scriptRoot
$oldGoos = $env:GOOS
$oldGoarch = $env:GOARCH
$oldCgoEnabled = $env:CGO_ENABLED
$resourceState = $null
$guardianResourceState = $null
$signatureInfo = $null
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
try {
  $resourceState = New-CordycepsWindowsBuildResource `
    -RepoRoot $repoRoot `
    -PackageDir (Join-Path $scriptRoot "cmd/d1") `
    -Version $Version `
    -ProductName "Cordyceps D1 Agent" `
    -FileDescription "Cordyceps D1 USB-ready Windows agent" `
    -OriginalFilename (Split-Path -Leaf $outputFullPath) `
    -InternalName "d1-agent"

  & go @buildArgs
  if ($LASTEXITCODE -ne 0) {
    throw "go build failed with exit code $LASTEXITCODE"
  }

  $guardianResourceState = New-CordycepsWindowsBuildResource `
    -RepoRoot $repoRoot `
    -PackageDir (Join-Path $scriptRoot "cmd/d1guardian") `
    -Version $Version `
    -ProductName "Cordyceps D1 Guardian" `
    -FileDescription "Cordyceps D1 guardian watchdog" `
    -OriginalFilename (Split-Path -Leaf $guardianOutputFullPath) `
    -InternalName "d1-guardian"

  & go @guardianBuildArgs
  if ($LASTEXITCODE -ne 0) {
    throw "go build failed with exit code $LASTEXITCODE"
  }

  $signatureInfo = Set-CordycepsAuthenticodeSignature `
    -FilePath $outputFullPath `
    -Thumbprint $CodeSigningThumbprint `
    -PfxPath $CodeSigningPfxPath `
    -PfxPassword $CodeSigningPfxPassword `
    -TimestampUrl $TimestampUrl

  Write-Host "Built USB-ready agent: $outputFullPath"
  Write-Host "Embedded setup: background=$backgroundValue startup=$startupValue"
  Write-Host "Embedded Windows metadata: version=$($resourceState.NormalizedVersion) icon=app manifest=gui"
  if ($null -ne $signatureInfo) {
    Write-Host "Authenticode: status=$($signatureInfo.Status) subject=$($signatureInfo.Subject)"
  }
  Write-Host "Built guardian: $guardianOutputFullPath"
  Write-Host "Usage on target PC: use install-d1-agent.ps1 so slot A, fallback, and guardian are installed together."
}
finally {
  Remove-CordycepsWindowsBuildResource -ResourceState $resourceState
  Remove-CordycepsWindowsBuildResource -ResourceState $guardianResourceState
  $env:GOOS = $oldGoos
  $env:GOARCH = $oldGoarch
  $env:CGO_ENABLED = $oldCgoEnabled
  Pop-Location
}
