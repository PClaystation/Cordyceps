# Easy Operations Guide

This page is the simplest path to run and operate Cordyceps.

## 1) Start the server

From repo root:

```bash
./start-server.sh
```

PowerShell:

```powershell
.\start-server.ps1
```

On first start, the server auto-creates missing tokens and saves them to `server/data/secrets.json`.

## 2) Check your token/config

From repo root:

```bash
./show-server-config.sh
```

PowerShell:

```powershell
.\show-server-config.ps1
```

Copy `PHONE_API_TOKEN` and server URL from the output to your phone app/shortcut.

## 3) Pick the right agent strain

- `t` (`t1`): standard remote control (best default)
- `e` (`e1`): standard + emergency lockdown + stricter safeguards
- `s` (`s1`): minimal/lite controls
- `se` (`se1`): lite + emergency lockdown
- `a` (`a1`): admin profile with deep system operations

## 4) Build a USB-ready agent EXE (Windows/PowerShell)

Use one command wrapper from repo root:

```powershell
.\ops\cordyceps.ps1 -Action build-usb -Strain t -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

Output will be in that strain folder under `dist/`.
If you already started the server once, `-BootstrapToken` can be omitted and auto-loaded from `server/data/secrets.json`.
For the legacy `agent` strain you can also bake install behavior into the EXE:

```powershell
.\ops\cordyceps.ps1 -Action build-usb -Strain agent -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN" -Background -Startup
```

That embeds:
- server URL
- bootstrap token
- whether first launch should detach into the background
- whether startup persistence should be registered

## 5) Install/start an agent on a Windows host

Run on the target Windows device:

```powershell
.\ops\cordyceps.ps1 -Action install -Strain t -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

`-BootstrapToken` can also be omitted here if `server/data/secrets.json` exists.
If you do not pass `-AgentExePath`, the wrapper auto-detects the strain binary from that folder (`<strain>/<name>.exe`, then `dist/<name>-usb.exe`, then `dist/<name>.exe`).

Optional extras:

- Set fixed ID: `-DeviceId "t5"`
- Set display name: `-DisplayName "Office PC"`
- Keep visible logs: `-Foreground`
- For `agent` builds with embedded server/token, `-ServerUrl` and `-BootstrapToken` can be omitted at install time

## 6) Daily operations on a Windows host

Check status:

```powershell
.\ops\cordyceps.ps1 -Action status -Strain t
```

Uninstall:

```powershell
.\ops\cordyceps.ps1 -Action uninstall -Strain t
```

## 7) If you only remember one command

```powershell
.\ops\cordyceps.ps1 -Action help
```

It prints all supported actions and examples.

## Troubleshooting (simple checklist)

- Server not reachable from phone:
  - confirm URL is HTTPS and points to your server origin
  - run `show-server-config` and verify token matches exactly
- Agent did not enroll:
  - confirm bootstrap token is correct
  - run `status` to check installed/running state
- Build failed:
  - install Go 1.23+
  - rerun `build-usb` with the same command and inspect the first error line
