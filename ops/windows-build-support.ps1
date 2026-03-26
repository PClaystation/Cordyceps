function ConvertTo-CordycepsWindowsVersion {
  param(
    [string]$Version
  )

  $matches = [regex]::Matches([string]$Version, "\d+")
  $parts = @(0, 0, 0, 0)
  $limit = [Math]::Min($matches.Count, 4)

  for ($index = 0; $index -lt $limit; $index++) {
    $value = 0
    [void][int]::TryParse($matches[$index].Value, [ref]$value)
    $parts[$index] = $value
  }

  return ($parts -join ".")
}

function New-CordycepsWindowsBuildResource {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$PackageDir,

    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$ProductName,

    [Parameter(Mandatory = $true)]
    [string]$FileDescription,

    [Parameter(Mandatory = $true)]
    [string]$OriginalFilename,

    [Parameter(Mandatory = $true)]
    [string]$InternalName,

    [string]$CompanyName = "Charlie Arnerstal",

    [string]$MinimumOs = "win7"
  )

  $packageFullPath = [System.IO.Path]::GetFullPath($PackageDir)
  if (-not (Test-Path -LiteralPath $packageFullPath)) {
    throw "Package directory not found: $packageFullPath"
  }

  $normalizedVersion = ConvertTo-CordycepsWindowsVersion -Version $Version
  $copyrightYear = (Get-Date).Year
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cordyceps-winres-" + [guid]::NewGuid().ToString("N"))
  $null = New-Item -ItemType Directory -Path $tempRoot -Force

  $iconCandidates = @(
    "ios/CordycepsRemote/CordycepsRemote/Assets.xcassets/AppIcon.appiconset/icon-60@2x.png",
    "ios/CordycepsRemote/CordycepsRemote/Assets.xcassets/AppIcon.appiconset/icon-60@3x.png",
    "ios/CordycepsRemote/CordycepsRemote/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
  )
  $iconPath = ""
  foreach ($candidate in $iconCandidates) {
    $candidatePath = Join-Path $RepoRoot $candidate
    if (Test-Path -LiteralPath $candidatePath) {
      $iconPath = $candidatePath
      break
    }
  }
  $iconGroup = [ordered]@{}
  if (-not [string]::IsNullOrWhiteSpace($iconPath) -and (Test-Path -LiteralPath $iconPath)) {
    $tempIconPath = Join-Path $tempRoot "icon-1024.png"
    Copy-Item -LiteralPath $iconPath -Destination $tempIconPath -Force
    $iconGroup = [ordered]@{
      APP = [ordered]@{
        "0000" = @([System.IO.Path]::GetFileName($tempIconPath))
      }
    }
  }

  $winres = [ordered]@{
    RT_GROUP_ICON = $iconGroup
    RT_MANIFEST   = [ordered]@{
      "#1" = [ordered]@{
        "0409" = [ordered]@{
          identity                            = [ordered]@{
            name    = $InternalName
            version = $normalizedVersion
          }
          description                         = $FileDescription
          "minimum-os"                        = $MinimumOs
          "execution-level"                   = "as invoker"
          "ui-access"                         = $false
          "auto-elevate"                      = $false
          "dpi-awareness"                     = "system"
          "disable-theming"                   = $false
          "disable-window-filtering"          = $false
          "high-resolution-scrolling-aware"   = $false
          "ultra-high-resolution-scrolling-aware" = $false
          "long-path-aware"                   = $true
          "printer-driver-isolation"          = $false
          "gdi-scaling"                       = $false
          "segment-heap"                      = $false
          "use-common-controls-v6"            = $true
        }
      }
    }
    RT_VERSION    = [ordered]@{
      "#1" = [ordered]@{
        "0000" = [ordered]@{
          fixed = [ordered]@{
            file_version    = $normalizedVersion
            product_version = $normalizedVersion
          }
          info  = [ordered]@{
            "0409" = [ordered]@{
              Comments         = "Cordyceps Windows agent"
              CompanyName      = $CompanyName
              FileDescription  = $FileDescription
              FileVersion      = $Version
              InternalName     = $InternalName
              LegalCopyright   = "Copyright (c) $copyrightYear $CompanyName"
              LegalTrademarks  = ""
              OriginalFilename = $OriginalFilename
              PrivateBuild     = ""
              ProductName      = $ProductName
              ProductVersion   = $Version
              SpecialBuild     = ""
            }
          }
        }
      }
    }
  }

  $winresJsonPath = Join-Path $tempRoot "winres.json"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText(
    $winresJsonPath,
    ($winres | ConvertTo-Json -Depth 12),
    $utf8NoBom
  )

  $resourcePrefix = Join-Path $packageFullPath "rsrc"
  $generatedSysoPath = Join-Path $packageFullPath "rsrc_windows_amd64.syso"
  if (Test-Path -LiteralPath $generatedSysoPath) {
    Remove-Item -LiteralPath $generatedSysoPath -Force
  }

  $goArgs = @(
    "run",
    "github.com/tc-hib/go-winres@v0.3.3",
    "make",
    "--in", $winresJsonPath,
    "--arch", "amd64",
    "--out", $resourcePrefix
  )

  & go @goArgs
  if ($LASTEXITCODE -ne 0) {
    throw "go-winres failed with exit code $LASTEXITCODE"
  }

  if (-not (Test-Path -LiteralPath $generatedSysoPath)) {
    throw "Expected Windows resource file was not created: $generatedSysoPath"
  }

  return [pscustomobject]@{
    SysoPath          = $generatedSysoPath
    TempDir           = $tempRoot
    NormalizedVersion = $normalizedVersion
  }
}

function Remove-CordycepsWindowsBuildResource {
  param(
    $ResourceState
  )

  if ($null -eq $ResourceState) {
    return
  }

  if ($ResourceState.PSObject.Properties.Name -contains "SysoPath") {
    $sysoPath = [string]$ResourceState.SysoPath
    if (-not [string]::IsNullOrWhiteSpace($sysoPath) -and (Test-Path -LiteralPath $sysoPath)) {
      Remove-Item -LiteralPath $sysoPath -Force -ErrorAction SilentlyContinue
    }
  }

  if ($ResourceState.PSObject.Properties.Name -contains "TempDir") {
    $tempDir = [string]$ResourceState.TempDir
    if (-not [string]::IsNullOrWhiteSpace($tempDir) -and (Test-Path -LiteralPath $tempDir)) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Set-CordycepsAuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string]$Thumbprint = "",

    [string]$PfxPath = "",

    [string]$PfxPassword = "",

    [string]$TimestampUrl = ""
  )

  $trimmedThumbprint = [string]$Thumbprint
  $trimmedPfxPath = [string]$PfxPath
  $trimmedTimestampUrl = [string]$TimestampUrl

  if ([string]::IsNullOrWhiteSpace($trimmedThumbprint) -and [string]::IsNullOrWhiteSpace($trimmedPfxPath)) {
    return $null
  }

  if (-not [string]::IsNullOrWhiteSpace($trimmedThumbprint) -and -not [string]::IsNullOrWhiteSpace($trimmedPfxPath)) {
    throw "Specify either Thumbprint or PfxPath for code signing, not both."
  }

  $signTool = Get-Command -Name "signtool.exe" -ErrorAction SilentlyContinue
  if ($null -eq $signTool) {
    throw "signtool.exe was not found. Install the Windows SDK signing tools or sign the file separately."
  }

  $resolvedFilePath = [System.IO.Path]::GetFullPath($FilePath)
  if (-not (Test-Path -LiteralPath $resolvedFilePath)) {
    throw "File to sign not found: $resolvedFilePath"
  }

  $signArgs = @(
    "sign",
    "/fd", "SHA256"
  )

  if (-not [string]::IsNullOrWhiteSpace($trimmedThumbprint)) {
    $signArgs += @("/sha1", $trimmedThumbprint.Trim())
  } else {
    $resolvedPfxPath = [System.IO.Path]::GetFullPath($trimmedPfxPath)
    if (-not (Test-Path -LiteralPath $resolvedPfxPath)) {
      throw "PFX file not found: $resolvedPfxPath"
    }

    $signArgs += @("/f", $resolvedPfxPath)
    if (-not [string]::IsNullOrWhiteSpace($PfxPassword)) {
      $signArgs += @("/p", $PfxPassword)
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($trimmedTimestampUrl)) {
    $signArgs += @("/tr", $trimmedTimestampUrl.Trim(), "/td", "SHA256")
  }

  $signArgs += $resolvedFilePath

  & $signTool.Path @signArgs
  if ($LASTEXITCODE -ne 0) {
    throw "signtool.exe failed with exit code $LASTEXITCODE"
  }

  $signature = Get-AuthenticodeSignature -FilePath $resolvedFilePath
  return [pscustomobject]@{
    Path          = $resolvedFilePath
    Status        = [string]$signature.Status
    StatusMessage = [string]$signature.StatusMessage
    Subject       = if ($null -ne $signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "" }
    Thumbprint    = if ($null -ne $signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { "" }
  }
}
