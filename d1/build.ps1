$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptRoot "build-d1-usb.ps1") `
  -ServerUrl "https://mpmc.ddns.net" `
  -BootstrapToken "3d1e6c7b9f2a4c8e5b0a7d1f9c2e6a4b" `
  -Background `
  -Startup
