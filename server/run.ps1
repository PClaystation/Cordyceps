$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required but not installed."
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

Write-Host "Starting Jarvis server..."
npm run dev
