param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$BootstrapToken,

  [string]$OutputPath = ".\dist\d1-agent-usb.exe",

  [string]$GuardianOutputPath = ".\dist\d1-guardian.exe",

  [string]$HeartbeatOutputPath = ".\dist\d1-heartbeat.exe",

  [string]$Drone1OutputPath = ".\dist\d1-drone-1.exe",

  [string]$Drone2OutputPath = ".\dist\d1-drone-2.exe",

  [string]$Drone3OutputPath = ".\dist\d1-drone-3.exe",

  [string]$Drone4OutputPath = ".\dist\d1-drone-4.exe",

  [string]$Drone5OutputPath = ".\dist\d1-drone-5.exe",

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
$heartbeatOutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $HeartbeatOutputPath))
$drone1OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone1OutputPath))
$drone2OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone2OutputPath))
$drone3OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone3OutputPath))
$drone4OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone4OutputPath))
$drone5OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone5OutputPath))
$outputDir = Split-Path -Parent $outputFullPath
$guardianOutputDir = Split-Path -Parent $guardianOutputFullPath
$heartbeatOutputDir = Split-Path -Parent $heartbeatOutputFullPath
$droneDirs = @(
  (Split-Path -Parent $drone1OutputFullPath),
  (Split-Path -Parent $drone2OutputFullPath),
  (Split-Path -Parent $drone3OutputFullPath),
  (Split-Path -Parent $drone4OutputFullPath),
  (Split-Path -Parent $drone5OutputFullPath)
)

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
New-Item -ItemType Directory -Path $guardianOutputDir -Force | Out-Null
New-Item -ItemType Directory -Path $heartbeatOutputDir -Force | Out-Null
foreach ($dir in $droneDirs) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

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

$heartbeatLdflags = @(
  "-H=windowsgui",
  "-X", "main.heartbeatVersion=$Version"
)

$heartbeatBuildArgs = @(
  "build",
  "-trimpath",
  "-ldflags", ($heartbeatLdflags -join " "),
  "-o", $heartbeatOutputFullPath,
  ".\cmd\d1heartbeat"
)

$droneBuildMatrix = @(
  @{ Role = "1"; Output = $drone1OutputFullPath },
  @{ Role = "2"; Output = $drone2OutputFullPath },
  @{ Role = "3"; Output = $drone3OutputFullPath },
  @{ Role = "4"; Output = $drone4OutputFullPath },
  @{ Role = "5"; Output = $drone5OutputFullPath }
)

Push-Location $scriptRoot
$oldGoos = $env:GOOS
$oldGoarch = $env:GOARCH
$oldCgoEnabled = $env:CGO_ENABLED
$resourceState = $null
$guardianResourceState = $null
$heartbeatResourceState = $null
$droneResourceStates = @()
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

  $heartbeatResourceState = New-CordycepsWindowsBuildResource `
    -RepoRoot $repoRoot `
    -PackageDir (Join-Path $scriptRoot "cmd/d1heartbeat") `
    -Version $Version `
    -ProductName "Cordyceps D1 Heartbeat" `
    -FileDescription "Cordyceps D1 heartbeat companion" `
    -OriginalFilename (Split-Path -Leaf $heartbeatOutputFullPath) `
    -InternalName "d1-heartbeat"

  & go @heartbeatBuildArgs
  if ($LASTEXITCODE -ne 0) {
    throw "go build failed with exit code $LASTEXITCODE"
  }

  foreach ($droneBuild in $droneBuildMatrix) {
    $droneLdflags = @(
      "-H=windowsgui",
      "-X", "main.droneVersion=$Version",
      "-X", "main.defaultRole=$($droneBuild.Role)"
    )

    $droneBuildArgs = @(
      "build",
      "-trimpath",
      "-ldflags", ($droneLdflags -join " "),
      "-o", $droneBuild.Output,
      ".\cmd\d1drone"
    )

    $droneResourceState = New-CordycepsWindowsBuildResource `
      -RepoRoot $repoRoot `
      -PackageDir (Join-Path $scriptRoot "cmd/d1drone") `
      -Version $Version `
      -ProductName "Cordyceps D1 Restore Drone $($droneBuild.Role)" `
      -FileDescription "Cordyceps D1 restore drone role $($droneBuild.Role)" `
      -OriginalFilename (Split-Path -Leaf $droneBuild.Output) `
      -InternalName ("d1-drone-" + $droneBuild.Role)

    $droneResourceStates += $droneResourceState

    & go @droneBuildArgs
    if ($LASTEXITCODE -ne 0) {
      throw "go build failed with exit code $LASTEXITCODE"
    }
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
  Write-Host "Built heartbeat companion: $heartbeatOutputFullPath"
  foreach ($droneBuild in $droneBuildMatrix) {
    Write-Host "Built restore drone role $($droneBuild.Role): $($droneBuild.Output)"
  }
  Write-Host "Usage on target PC: use install-d1-agent.ps1 so slot A, fallback, guardian, heartbeat companion, and the initial restore drone seed set are installed together."
}
finally {
  Remove-CordycepsWindowsBuildResource -ResourceState $resourceState
  Remove-CordycepsWindowsBuildResource -ResourceState $guardianResourceState
  Remove-CordycepsWindowsBuildResource -ResourceState $heartbeatResourceState
  foreach ($droneResourceState in $droneResourceStates) {
    Remove-CordycepsWindowsBuildResource -ResourceState $droneResourceState
  }
  $env:GOOS = $oldGoos
  $env:GOARCH = $oldGoarch
  $env:CGO_ENABLED = $oldCgoEnabled
  Pop-Location
}
