param(
  [ValidateSet("help", "start-server", "show-config", "build-usb", "install", "status", "uninstall")]
  [string]$Action = "help",

  [string]$Strain = "t",

  [string]$ServerUrl = "",

  [string]$BootstrapToken = "",

  [string]$DeviceId = "",

  [string]$DisplayName = "",

  [string]$AgentExePath = "",

  [string]$OutputPath = "",

  [string]$Version = "",

  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

$opsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $opsRoot

$strainConfigs = @{
  "agent" = @{
    Dir = "agent"
    BuildScript = $null
    InstallScript = "install-jarvis-agent.ps1"
    ManageScript = "manage-jarvis-agent.ps1"
    ExeName = "cordyceps-agent.exe"
  }
  "t1" = @{
    Dir = "t1"
    BuildScript = "build-t1-usb.ps1"
    InstallScript = "install-t1-agent.ps1"
    ManageScript = "manage-t1-agent.ps1"
    ExeName = "t1-agent.exe"
  }
  "s1" = @{
    Dir = "s1"
    BuildScript = "build-s1-usb.ps1"
    InstallScript = "install-s1-agent.ps1"
    ManageScript = "manage-s1-agent.ps1"
    ExeName = "s1-agent.exe"
  }
  "se1" = @{
    Dir = "se1"
    BuildScript = "build-se1-usb.ps1"
    InstallScript = "install-se1-agent.ps1"
    ManageScript = "manage-se1-agent.ps1"
    ExeName = "se1-agent.exe"
  }
  "e1" = @{
    Dir = "e1"
    BuildScript = "build-e1-usb.ps1"
    InstallScript = "install-e1-agent.ps1"
    ManageScript = "manage-e1-agent.ps1"
    ExeName = "e1-agent.exe"
  }
  "a1" = @{
    Dir = "a1"
    BuildScript = "build-a1-usb.ps1"
    InstallScript = "install-a1-agent.ps1"
    ManageScript = "manage-a1-agent.ps1"
    ExeName = "a1-agent.exe"
  }
}

function Resolve-Strain([string]$value) {
  $trimmed = $value.Trim().ToLowerInvariant()
  switch ($trimmed) {
    "agent" { return "agent" }
    "legacy" { return "agent" }
    "jarvis" { return "agent" }
    "t" { return "t1" }
    "t1" { return "t1" }
    "s" { return "s1" }
    "s1" { return "s1" }
    "se" { return "se1" }
    "se1" { return "se1" }
    "e" { return "e1" }
    "e1" { return "e1" }
    "a" { return "a1" }
    "a1" { return "a1" }
    default {
      throw "Unknown strain '$value'. Use one of: t, e, s, se, a, agent."
    }
  }
}

function Ensure-Required([string]$value, [string]$name) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required for this action."
  }
}

function Try-GetBootstrapTokenFromSecrets {
  $secretsPath = Join-Path $repoRoot "server/data/secrets.json"
  if (-not (Test-Path -LiteralPath $secretsPath)) {
    return ""
  }

  try {
    $payload = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
    if ($null -ne $payload -and -not [string]::IsNullOrWhiteSpace($payload.agent_bootstrap_token)) {
      return [string]$payload.agent_bootstrap_token
    }
  } catch {
    return ""
  }

  return ""
}

function Invoke-RepoScript([string]$relativeScriptPath, [string[]]$arguments) {
  $scriptPath = Join-Path $repoRoot $relativeScriptPath
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Script not found: $scriptPath"
  }

  & $scriptPath @arguments
}

function Resolve-DefaultAgentExePath([hashtable]$strainConfig) {
  $strainDir = Join-Path $repoRoot $strainConfig.Dir
  $exeName = [string]$strainConfig.ExeName
  $usbExeName = $exeName -replace "\.exe$", "-usb.exe"

  $candidates = @(
    (Join-Path $strainDir $exeName),
    (Join-Path $strainDir (Join-Path "dist" $usbExeName)),
    (Join-Path $strainDir (Join-Path "dist" $exeName))
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  return ""
}

function Show-Help {
  Write-Host "Cordyceps Easy Operator Script"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  .\\ops\\cordyceps.ps1 -Action <action> [options]"
  Write-Host ""
  Write-Host "Actions:"
  Write-Host "  help         Show this help"
  Write-Host "  start-server Start the TypeScript server"
  Write-Host "  show-config  Show effective server config"
  Write-Host "  build-usb    Build a USB-ready agent EXE"
  Write-Host "  install      Install/run agent on this Windows host"
  Write-Host "  status       Show installed/running status on this host"
  Write-Host "  uninstall    Remove agent from this host"
  Write-Host ""
  Write-Host "Strain shortcuts (for -Strain):"
  Write-Host "  t   -> t1 (standard)"
  Write-Host "  e   -> e1 (secure + emergency)"
  Write-Host "  s   -> s1 (lite)"
  Write-Host "  se  -> se1 (lite + emergency)"
  Write-Host "  a   -> a1 (admin)"
  Write-Host "  agent -> legacy Cordyceps/Jarvis agent"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  .\\ops\\cordyceps.ps1 -Action start-server"
  Write-Host "  .\\ops\\cordyceps.ps1 -Action build-usb -Strain t -ServerUrl https://example.com -BootstrapToken TOKEN"
  Write-Host "  .\\ops\\cordyceps.ps1 -Action install -Strain t -ServerUrl https://example.com -BootstrapToken TOKEN"
  Write-Host "  .\\ops\\cordyceps.ps1 -Action status -Strain t"
  Write-Host "  .\\ops\\cordyceps.ps1 -Action uninstall -Strain t"
  Write-Host ""
  Write-Host "Tip: -BootstrapToken is optional if server/data/secrets.json exists."
  Write-Host "Tip: install auto-detects agent binaries from each strain folder if -AgentExePath is omitted."
}

if ($Action -eq "help") {
  Show-Help
  exit 0
}

$resolvedStrain = ""
$strainConfig = $null
if ($Action -in @("build-usb", "install", "status", "uninstall")) {
  $resolvedStrain = Resolve-Strain $Strain
  $strainConfig = $strainConfigs[$resolvedStrain]
}

switch ($Action) {
  "start-server" {
    Invoke-RepoScript "server/run.ps1" @()
  }
  "show-config" {
    Push-Location (Join-Path $repoRoot "server")
    try {
      npm run show-config
    }
    finally {
      Pop-Location
    }
  }
  "build-usb" {
    if ($null -eq $strainConfig.BuildScript) {
      throw "Strain '$resolvedStrain' does not support USB builder script. Use t/e/s/se/a strains."
    }

    $effectiveBootstrapToken = $BootstrapToken
    if ([string]::IsNullOrWhiteSpace($effectiveBootstrapToken)) {
      $effectiveBootstrapToken = Try-GetBootstrapTokenFromSecrets
      if (-not [string]::IsNullOrWhiteSpace($effectiveBootstrapToken)) {
        Write-Host "Using bootstrap token from server/data/secrets.json"
      }
    }

    Ensure-Required $ServerUrl "ServerUrl"
    Ensure-Required $effectiveBootstrapToken "BootstrapToken"

    $buildArgs = @(
      "-ServerUrl", $ServerUrl,
      "-BootstrapToken", $effectiveBootstrapToken
    )

    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
      $buildArgs += @("-OutputPath", $OutputPath)
    }

    if (-not [string]::IsNullOrWhiteSpace($Version)) {
      $buildArgs += @("-Version", $Version)
    }

    Invoke-RepoScript "$($strainConfig.Dir)/$($strainConfig.BuildScript)" $buildArgs
  }
  "install" {
    $effectiveBootstrapToken = $BootstrapToken
    if ([string]::IsNullOrWhiteSpace($effectiveBootstrapToken)) {
      $effectiveBootstrapToken = Try-GetBootstrapTokenFromSecrets
      if (-not [string]::IsNullOrWhiteSpace($effectiveBootstrapToken)) {
        Write-Host "Using bootstrap token from server/data/secrets.json"
      }
    }

    Ensure-Required $ServerUrl "ServerUrl"
    Ensure-Required $effectiveBootstrapToken "BootstrapToken"

    $installArgs = @(
      "-ServerUrl", $ServerUrl,
      "-BootstrapToken", $effectiveBootstrapToken
    )

    $resolvedAgentExePath = ""
    if (-not [string]::IsNullOrWhiteSpace($AgentExePath)) {
      $resolvedAgentExePath = [System.IO.Path]::GetFullPath($AgentExePath)
    } else {
      $resolvedAgentExePath = Resolve-DefaultAgentExePath $strainConfig
      if (-not [string]::IsNullOrWhiteSpace($resolvedAgentExePath)) {
        Write-Host "Using detected agent binary: $resolvedAgentExePath"
      }
    }

    if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
      $installArgs += @("-DeviceId", $DeviceId)
    }

    if (-not [string]::IsNullOrWhiteSpace($DisplayName)) {
      $installArgs += @("-DisplayName", $DisplayName)
    }

    if (-not [string]::IsNullOrWhiteSpace($AgentExePath)) {
      $installArgs += @("-AgentExePath", $resolvedAgentExePath)
    } elseif (-not [string]::IsNullOrWhiteSpace($resolvedAgentExePath)) {
      $installArgs += @("-AgentExePath", $resolvedAgentExePath)
    }

    if ($Foreground.IsPresent) {
      $installArgs += "-Foreground"
    }

    Invoke-RepoScript "$($strainConfig.Dir)/$($strainConfig.InstallScript)" $installArgs
  }
  "status" {
    Invoke-RepoScript "$($strainConfig.Dir)/$($strainConfig.ManageScript)" @("-Action", "status")
  }
  "uninstall" {
    Invoke-RepoScript "$($strainConfig.Dir)/$($strainConfig.ManageScript)" @("-Action", "uninstall")
  }
  default {
    throw "Unsupported action '$Action'."
  }
}
