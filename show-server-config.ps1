$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "server")
npm run show-config
