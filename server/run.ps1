$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required but not installed."
}

$stampFile = "node_modules/.install-stamp"
$needsInstall = $false

if (-not (Test-Path "node_modules")) {
  $needsInstall = $true
} elseif (-not (Test-Path $stampFile)) {
  $needsInstall = $true
} else {
  $packageJson = Get-Item "package.json"
  $lockFile = Get-Item "package-lock.json" -ErrorAction SilentlyContinue
  $stamp = Get-Item $stampFile

  if ($packageJson.LastWriteTimeUtc -gt $stamp.LastWriteTimeUtc) {
    $needsInstall = $true
  } elseif ($lockFile -and $lockFile.LastWriteTimeUtc -gt $stamp.LastWriteTimeUtc) {
    $needsInstall = $true
  }
}

if ($needsInstall) {
  Write-Host "Installing dependencies..."
  npm install
  if (-not (Test-Path "node_modules")) {
    New-Item -Path "node_modules" -ItemType Directory | Out-Null
  }
  New-Item -Path $stampFile -ItemType File -Force | Out-Null
}

Write-Host "Starting Jarvis server..."
npm run dev
