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

  [string]$Drone6OutputPath = ".\dist\d1-drone-6.exe",

  [string]$Drone7OutputPath = ".\dist\d1-drone-7.exe",

  [string]$Drone8OutputPath = ".\dist\d1-drone-8.exe",

  [string]$Drone9OutputPath = ".\dist\d1-drone-9.exe",

  [string]$Drone10OutputPath = ".\dist\d1-drone-10.exe",

  [string]$Drone11OutputPath = ".\dist\d1-drone-11.exe",

  [string]$Drone12OutputPath = ".\dist\d1-drone-12.exe",

  [string]$Drone13OutputPath = ".\dist\d1-drone-13.exe",

  [string]$Drone14OutputPath = ".\dist\d1-drone-14.exe",

  [string]$Drone15OutputPath = ".\dist\d1-drone-15.exe",

  [string]$Drone16OutputPath = ".\dist\d1-drone-16.exe",

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
$drone6OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone6OutputPath))
$drone7OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone7OutputPath))
$drone8OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone8OutputPath))
$drone9OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone9OutputPath))
$drone10OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone10OutputPath))
$drone11OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone11OutputPath))
$drone12OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone12OutputPath))
$drone13OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone13OutputPath))
$drone14OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone14OutputPath))
$drone15OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone15OutputPath))
$drone16OutputFullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot $Drone16OutputPath))
$outputDir = Split-Path -Parent $outputFullPath
$guardianOutputDir = Split-Path -Parent $guardianOutputFullPath
$heartbeatOutputDir = Split-Path -Parent $heartbeatOutputFullPath
$bundleOutputDir = Join-Path $scriptRoot "cmd\d1\bundled\windows-amd64"
$guardianBundleFullPath = Join-Path $bundleOutputDir "d1-guardian.bin"
$heartbeatBundleFullPath = Join-Path $bundleOutputDir "d1-heartbeat.bin"
$droneDirs = @(
  (Split-Path -Parent $drone1OutputFullPath),
  (Split-Path -Parent $drone2OutputFullPath),
  (Split-Path -Parent $drone3OutputFullPath),
  (Split-Path -Parent $drone4OutputFullPath),
  (Split-Path -Parent $drone5OutputFullPath),
  (Split-Path -Parent $drone6OutputFullPath),
  (Split-Path -Parent $drone7OutputFullPath),
  (Split-Path -Parent $drone8OutputFullPath),
  (Split-Path -Parent $drone9OutputFullPath),
  (Split-Path -Parent $drone10OutputFullPath),
  (Split-Path -Parent $drone11OutputFullPath),
  (Split-Path -Parent $drone12OutputFullPath),
  (Split-Path -Parent $drone13OutputFullPath),
  (Split-Path -Parent $drone14OutputFullPath),
  (Split-Path -Parent $drone15OutputFullPath),
  (Split-Path -Parent $drone16OutputFullPath)
)

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
New-Item -ItemType Directory -Path $guardianOutputDir -Force | Out-Null
New-Item -ItemType Directory -Path $heartbeatOutputDir -Force | Out-Null
if (Test-Path -LiteralPath $bundleOutputDir) {
  Remove-Item -LiteralPath $bundleOutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $bundleOutputDir -Force | Out-Null
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
  "-tags", "bundledcompanions",
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
  @{ Role = "1"; Output = $drone1OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-1.bin") },
  @{ Role = "2"; Output = $drone2OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-2.bin") },
  @{ Role = "3"; Output = $drone3OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-3.bin") },
  @{ Role = "4"; Output = $drone4OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-4.bin") },
  @{ Role = "5"; Output = $drone5OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-5.bin") },
  @{ Role = "6"; Output = $drone6OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-6.bin") },
  @{ Role = "7"; Output = $drone7OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-7.bin") },
  @{ Role = "8"; Output = $drone8OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-8.bin") },
  @{ Role = "9"; Output = $drone9OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-9.bin") },
  @{ Role = "10"; Output = $drone10OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-10.bin") },
  @{ Role = "11"; Output = $drone11OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-11.bin") },
  @{ Role = "12"; Output = $drone12OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-12.bin") },
  @{ Role = "13"; Output = $drone13OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-13.bin") },
  @{ Role = "14"; Output = $drone14OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-14.bin") },
  @{ Role = "15"; Output = $drone15OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-15.bin") },
  @{ Role = "16"; Output = $drone16OutputFullPath; Bundle = (Join-Path $bundleOutputDir "d1-drone-16.bin") }
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
  Copy-Item -LiteralPath $guardianOutputFullPath -Destination $guardianBundleFullPath -Force

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
  Copy-Item -LiteralPath $heartbeatOutputFullPath -Destination $heartbeatBundleFullPath -Force

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
    Copy-Item -LiteralPath $droneBuild.Output -Destination $droneBuild.Bundle -Force
  }

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
  Write-Host "Embedded companion bundle: guardian, heartbeat, and restore drones are packed into the main agent EXE."
  Write-Host "Usage on target PC: run $outputFullPath once and it will self-install, self-stage the companion fleet, and start the D1 stack."
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
