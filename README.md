# Cordyceps Remote Device Control

Phone-driven mycelium command platform:

- iPhone Shortcut captures speech as text and injects it into the colony core
- Built-in PWA canopy (`/app`) for iPhone/home-screen use
- Server parses and routes strict typed commands
- Windows node agents receive typed command envelopes over outbound WSS
- Node agents execute allowlisted actions only

## Start Here (Simplest Path)

If you want the fastest operator workflow, use the shortcuts below from repo root:

1. Start server:
   - macOS/Linux: `./start-server.sh`
   - PowerShell: `.\start-server.ps1`
2. Show live server config/tokens:
   - macOS/Linux: `./show-server-config.sh`
   - PowerShell: `.\show-server-config.ps1`
3. Build/install/manage Windows agents with one wrapper:
   - `.\ops\cordyceps.ps1 -Action help`

Simple copy/paste operation guide: [docs/easy-operations.md](docs/easy-operations.md)

## Current Colony Capabilities

- `POST /api/command` with deterministic parser and auth
- Optional async command execution (`POST /api/command` with `async=true`) + job status (`GET /api/command-jobs/:requestId`)
- `POST /api/update` for one-button remote agent updates
- `GET /api/health`
- `POST /api/enroll` for first-run device enrollment
- `GET /api/devices` (phone-authenticated)
- `GET /api/devices/:deviceId` rich per-device state (control flags, aliases, queued updates, recent logs)
- Remote-managed per-device app aliases (`GET/PUT /api/devices/:deviceId/app-aliases`)
- `GET /api/admin/overview` aggregated security/update/device visibility
- Auth lifecycle endpoints:
  - `POST /api/auth/keys/:keyId/rotate` (replacement key + revoke old key)
  - `POST /api/auth/tokens/rotate` (owner/bootstrap rotation with owner-token grace window)
- PWA routes: `/app`, `/app.js`, `/app.css`, `/manifest.webmanifest`, `/sw.js`
- Agent WebSocket auth handshake + heartbeat
- Presence tracking (`online`/`offline` + `last_seen`)
- Request/response correlation with command timeout
- WebSocket auth timeout + ping keepalive + max-message-size guard
- Router backpressure + per-device command serialization
- Server-side package hash inspection (if `sha256` omitted on update requests)
- Optional/required detached signature verification for update payload metadata
- SQLite `devices` + `command_logs`
- Go agent with redundant startup persistence (Task Scheduler logon + boot + 1-minute watchdog + HKCU Run-key)
- Allowlisted agent actions:
  - `PING`
  - `OPEN_APP` (`spotify`, `discord`, `chrome`, `steam`, `explorer`, `vscode`, `edge`, `firefox`, `notepad`, `calculator`, `settings`, `slack`, `teams`, `taskmanager`, `terminal`, `powershell`, `cmd`, `controlpanel`, `paint`, `snippingtool`)
  - `MEDIA_PLAY`, `MEDIA_PAUSE`, `MEDIA_PLAY_PAUSE`, `MEDIA_NEXT`, `MEDIA_PREVIOUS`
  - `VOLUME_UP`, `VOLUME_DOWN`, `MUTE`
  - `LOCK_PC`
  - `NOTIFY`
  - `CLIPBOARD_SET`
  - `TYPE_TEXT` (implemented in `t1`, `e1`, and `a1` agent families)
  - `SYSTEM_SLEEP`, `SYSTEM_DISPLAY_OFF`, `SYSTEM_SIGN_OUT`, `SYSTEM_SHUTDOWN`, `SYSTEM_RESTART`
    (power-impacting commands require `CORDYCEPS_ALLOW_POWER_COMMANDS=1` or `JARVIS_ALLOW_POWER_COMMANDS=1`)
  - `AGENT_REMOVE` (local host must approve via multi-step prompt and requires `CORDYCEPS_ALLOW_AGENT_REMOVE=1` or `JARVIS_ALLOW_AGENT_REMOVE=1`)
  - `EMERGENCY_LOCKDOWN` (implemented in `e1` and `se1` agent families only)
  - Admin-only command family (implemented in `a1` agent family):
    - `ADMIN_EXEC_CMD`, `ADMIN_EXEC_POWERSHELL`
    - `PROCESS_LIST`, `PROCESS_KILL`, `PROCESS_START`, `PROCESS_DETAILS`
    - `SERVICE_LIST`, `SERVICE_CONTROL`, `SERVICE_DETAILS`
    - `FILE_READ`, `FILE_WRITE`, `FILE_APPEND`, `FILE_COPY`, `FILE_MOVE`, `FILE_EXISTS`, `FILE_HASH`, `FILE_TAIL`, `FILE_DELETE`, `FILE_LIST`, `FILE_MKDIR`
    - `NETWORK_INFO`, `NETWORK_TEST`, `NETWORK_FLUSH_DNS`
    - `EVENT_LOG_QUERY`
    - `ENV_LIST`, `ENV_GET`
    - `SYSTEM_INFO`
  - `AGENT_UPDATE` (via `POST /api/update`)

## Colony Layout

- `server/` Node.js + TypeScript dispatcher
- `agent/` Go Windows node agent (single binary)
- `s1/` Go Windows lite strain family (`s*` IDs; basic control only, no emergency lockdown)
- `se1/` Go Windows lite+emergency strain family (`se*` IDs; `s` surface + emergency lockdown)
- `t1/` Go Windows standard remote-control strain family (`t*` IDs; regular full remote control)
- `e1/` Go Windows secure+emergency strain family (`e*` IDs; `t` + emergency lockdown + stricter local allowlist security)
- `a1/` Go Windows admin strain family (`a*` IDs; broad system operations)
- `docs/iphone-shortcut.md` iPhone Shortcut wiring
- `docs/agent-profiles.md` canonical strain matrix and command-surface policy

## Agent Strains

Canonical strain intent:

- `s`: super-basic lite profile; no emergency lockdown.
- `se`: `s` + emergency lockdown security.
- `t`: regular remote control profile.
- `e`: `t` + emergency lockdown + stricter security behavior.
- `a`: admin profile with widest control surface.

The full strain command-surface matrix is documented in [docs/agent-profiles.md](docs/agent-profiles.md).

## Spore Command Language (Phone -> Server)

Command format:

- `<target> <action> [argument]`

Examples:

- `m1 ping`
- `m1 open spotify`
- `m1 pause`
- `m1 play pause`
- `m2 volume up`
- `m2 volume down 4`
- `m3 lock`
- `m1 clipboard copied from jarvis`
- `t1 type hello from remote`
- `m1 display off`
- `m1 sign out`
- `m1 open vscode`
- `m1 open task manager`
- `m1 open terminal`
- `m1 open powershell`
- `m1 restart`
- `m1 remove agent confirm confirm`
- `e1 panic confirm`
- `a1 admin cmd whoami`
- `a1 admin ps Get-Process | Select-Object -First 5`
- `a1 admin process list chrome`
- `a1 admin process kill notepad`
- `a1 admin process start notepad.exe`
- `a1 admin process details explorer`
- `a1 admin service restart spooler`
- `a1 admin service details spooler`
- `a1 admin file read C:\Temp\notes.txt`
- `a1 admin file write C:\Temp\notes.txt :: hello from admin`
- `a1 admin file copy C:\Temp\notes.txt -> C:\Temp\notes-copy.txt`
- `a1 admin file hash sha512 C:\Temp\notes.txt`
- `a1 admin file tail C:\Temp\notes.txt 30`
- `a1 admin network info`
- `a1 admin network test 1.1.1.1 443`
- `a1 admin event log System limit 5`
- `a1 admin env get PATH`
- `a1 admin system info`
- `m1 notify hello`
- `all ping`

Notes:

- parser lowercases and normalizes spaces
- `all` is intentionally restricted to `ping` to avoid accidental colony-wide actions
- `volume up/down`, `next`, and `previous` support optional numeric repeats (`1-20`)
- app launch verbs supported: `open`, `launch`, `start`
- `type <text>` sends literal keyboard text to the focused window (available on `t`, `e`, and `a` profiles)
- emergency command requires explicit confirmation (`panic confirm`, `lockdown confirm`, or `emergency confirm`)
- agent removal requires explicit remote confirmation (`remove agent confirm confirm`); no local host interaction is required on the target PC
- admin commands must use `admin ...` and are dispatched only to devices that advertise `admin_ops` capability (A1 family)
- server enforces profile routing policy (`s`, `se`, `t`, `e`, `a`) using capability markers (`profile_s`, `profile_se`, `profile_t`, `profile_e`, `profile_a`) with device-ID prefix fallback

## Mycelium Core Setup

1. Install Node.js 20+
2. Create env file:
   - `cp server/.env.example server/.env`
3. Optional: set values in `server/.env`:
   - `PUBLIC_WS_URL` (use `wss://...` behind TLS)
   - `PHONE_API_TOKEN` and `AGENT_BOOTSTRAP_TOKEN` (if omitted, they are auto-generated and persisted)
4. Optional hardening knobs:
   - `COMMAND_TIMEOUT_MS`
   - `ADMIN_COMMAND_TIMEOUT_MS`
   - `POWER_COMMAND_TIMEOUT_MS`
   - `MAX_PENDING_COMMANDS`
   - `WS_AUTH_TIMEOUT_MS`
   - `WS_PING_INTERVAL_MS`
   - `WS_MAX_MESSAGE_BYTES`
  - `UPDATE_COMMAND_TIMEOUT_MS`
  - `UPDATE_METADATA_TIMEOUT_MS`
  - `UPDATE_MAX_PACKAGE_BYTES`
  - `ENFORCE_HTTPS_UPDATE_URL`
  - `UPDATE_REQUIRE_SIGNATURE` + `UPDATE_SIGNING_KEYS` (phase 2 signed-package hardening)
  - `ALLOW_AUTOMATIC_UPDATES` (default `false`; keeps update policy queueing/manual updates under operator control)
  - `CORS_ALLOWED_ORIGINS` (comma-separated explicit origins; defaults already include `https://pclaystation.github.io` and `https://mpmc.ddns.net`)
5. Install and run (from repo root):

```bash
./start-server.sh
```

PowerShell:

```powershell
.\start-server.ps1
```

Classic path (same behavior):

```bash
cd server
npm install
npm run dev
```

Or one command:

```bash
cd server
./run.sh
```

Windows PowerShell equivalent: `./run.ps1`

Both scripts auto-run `npm install` when dependencies changed.

On first start, the server now auto-generates tokens if missing and saves them to `server/data/secrets.json`.
It also logs:

- `pwa_url`
- `pwa_pairing_url` (open once on iPhone to auto-fill token, API, target, and defaults)
- `external_pwa_pairing_url` (GitHub Pages pairing link)

Show current effective config anytime:

```bash
./show-server-config.sh
```

PowerShell equivalent: `.\show-server-config.ps1`

Production:

- run behind TLS reverse proxy (Nginx/Caddy/Cloudflare Tunnel)
- expose HTTPS for `/api/*` and WSS for `/ws/agent`

## Node Setup (Windows)

### One wrapper for all strains (recommended)

Use this wrapper from repo root so you do not need to remember per-folder script names:

```powershell
.\ops\cordyceps.ps1 -Action help
```

Common usage:

```powershell
# Build USB agent (t/e/s/se/a)
.\ops\cordyceps.ps1 -Action build-usb -Strain t -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"

# Install/start on target Windows host
.\ops\cordyceps.ps1 -Action install -Strain t -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"

# Check status
.\ops\cordyceps.ps1 -Action status -Strain t

# Uninstall
.\ops\cordyceps.ps1 -Action uninstall -Strain t
```

If `server/data/secrets.json` exists, `-BootstrapToken` is optional for `build-usb` and `install`.

### Fastest way to colonize another device (T1 agent)

Use this for the `t` strain: the regular remote-control model (no emergency-lockdown features).

1. Build a USB-ready T1 agent once (on any machine with Go):

```powershell
cd t1
.\build-t1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

This produces `t1/dist/t1-agent-usb.exe` with your server URL and bootstrap token embedded at build time.

2. Copy that EXE to a USB stick, move it to the target Windows device, and run it once.

That is it. On first run the EXE:

- copies itself to `%LOCALAPPDATA%\T1Agent\t1-agent.exe`
- enrolls with the embedded server URL + bootstrap token
- writes config to `%APPDATA%\T1Agent\config.json`
- registers startup
- relaunches hidden in the background

If you still want the old PowerShell installer flow or an explicit `-DeviceId`, `t1/install-t1-agent.ps1` still works.

Management:

- `.\manage-t1-agent.ps1 -Action status`
- `.\manage-t1-agent.ps1 -Action uninstall`

### Emergency-capable strain (E1 agent)

Use this for the `e` strain: the regular `t` remote-control surface plus emergency lockdown and stricter local safety controls.

1. Build a USB-ready E1 agent once:

```powershell
cd e1
.\build-e1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `e1/dist/e1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\E1Agent\e1-agent.exe` and auto-designates `e*` IDs when `-DeviceId` is omitted.
`e1` is intentionally distinct from `t1`: it keeps the standard surface but enforces an explicit local command allowlist and emergency hardening (restart-persistent cooldown, local audit log, persisted panic-active state, rollback-on-failure cleanup, and temporary network isolation with failsafe rollback). While panic mode is active, only `ping`, `lock`, and another confirmed emergency command remain executable.

Management:

- `.\manage-e1-agent.ps1 -Action status`
- `.\manage-e1-agent.ps1 -Action uninstall`

### Lite safety strain (S1 agent)

Use this for the `s` strain: super-basic control for users who do not want deep remote control and do not want emergency lockdown enabled.

1. Build a USB-ready S1 agent once:

```powershell
cd s1
.\build-s1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `s1/dist/s1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\S1Agent\s1-agent.exe` and auto-designates `s*` IDs when `-DeviceId` is omitted.
`s1` is the smallest non-admin surface: no sleep/sign-out/shutdown/restart, no remove-agent path, and no emergency-lockdown feature.

Management:

- `.\manage-s1-agent.ps1 -Action status`
- `.\manage-s1-agent.ps1 -Action uninstall`

### Lite+emergency safety strain (SE1 agent)

Use this for the `se` strain: the `s` lite surface plus emergency lockdown security.

1. Build a USB-ready SE1 agent once:

```powershell
cd se1
.\build-se1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `se1/dist/se1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\SE1Agent\se1-agent.exe` and auto-designates `se*` IDs when `-DeviceId` is omitted.
`se1` is intentionally a mix of `s1` and `e1`: it keeps the lite command surface and adds the same hardened emergency-lockdown flow (cooldown, audit log, persisted panic state, rollback cleanup, and failsafe network rollback). During panic mode, normal commands are blocked until rollback clears emergency state.

Management:

- `.\manage-se1-agent.ps1 -Action status`
- `.\manage-se1-agent.ps1 -Action uninstall`

### Admin strain (A1 agent)

Use this for the `a` strain: admin-level remote control with broad system operations.

1. Build a USB-ready A1 agent once:

```powershell
cd a1
.\build-a1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `a1/dist/a1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\A1Agent\a1-agent.exe` and auto-designates `a*` IDs when `-DeviceId` is omitted.
`a1` is intentionally the widest profile: everything in standard control plus the admin command family (process/service/file/network/event-log/environment/system tooling and raw `admin cmd` / `admin ps`).

Management:

- `.\manage-a1-agent.ps1 -Action status`
- `.\manage-a1-agent.ps1 -Action uninstall`

### Manual setup (original agent)

1. Install Go 1.23+ or build on another machine and copy exe
2. Build:

```bash
cd agent
go build -o cordyceps-agent.exe ./cmd/agent
```

3. First-run enrollment:

```powershell
.\cordyceps-agent.exe --server-url "https://your-server.example" --device-id "m1" --bootstrap-token "YOUR_BOOTSTRAP_TOKEN"
```

Windows runtime behavior:

- default: relaunches itself detached in the background (safe to close the launching terminal)
- debug mode: add `--foreground` to keep logs attached to your console

What first run does:

- enrolls via `/api/enroll`
- stores long-lived device token in user config
- registers startup persistence with multiple launch paths:
  - Task Scheduler at user logon
  - Task Scheduler at system boot
  - Task Scheduler watchdog every 1 minute (mutex-guarded, safe if already running)
  - HKCU Run-key at logon
- starts outbound WebSocket session

Default config path on Windows:

- `%APPDATA%\CordycepsAgent\config.json`

Optional installer script:

```powershell
.\install-jarvis-agent.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN" -DeviceId "m1"
```

Management:

- `.\manage-jarvis-agent.ps1 -Action status`
- `.\manage-jarvis-agent.ps1 -Action uninstall`

## iPhone Shortcut

See [docs/iphone-shortcut.md](docs/iphone-shortcut.md).

## Native iOS Field App

A native SwiftUI iPhone app is available in:

- `ios/CordycepsRemote/`

Open `ios/CordycepsRemote/CordycepsRemote.xcodeproj` in Xcode and follow:

- [ios/CordycepsRemote/README.md](ios/CordycepsRemote/README.md)

## PWA Canopy (Recommended)

Open this URL on iPhone:

- `https://mpmc.ddns.net/app`

Then:

1. Preferred: open the `pwa_pairing_url` printed by server logs (auto-fills token, API, target, and default command/update target)
2. Or paste your `PHONE_API_TOKEN` in the app and tap `Save`
   - Set `API base URL` to your server origin (for same-host deployment this auto-fills)
3. Tap `Load Devices` to verify connectivity
4. Build/send commands directly from the app
5. Use the `Agent Update` panel to push updates by target + version + package URL
   - For a single offline target, keep `Queue update if target is offline` enabled to dispatch automatically on next reconnect
6. Optional: Share -> `Add to Home Screen` for app-like launch

Notes:

- Do not use `:8080` with HTTPS in the browser/PWA URL
- The token is stored in browser local storage on that device

### GitHub Pages Canopy

GitHub Pages can host the client only (not your Node server/agent).

1. Host the contents of `server/public/` on Pages
   - Included workflow: `.github/workflows/deploy-pages.yml`
   - In GitHub repo settings, set Pages source to `GitHub Actions`
2. In the client, set `API base URL` to `https://mpmc.ddns.net`
3. Server CORS:
   - Defaults already include `https://pclaystation.github.io` and `https://mpmc.ddns.net`
   - If you change domains later, set `CORS_ALLOWED_ORIGINS` accordingly

Detailed guide: [docs/github-pages.md](docs/github-pages.md)

## API Pulse Test

Health:

```bash
curl http://localhost:8080/api/health
```

Phone command:

```bash
curl -X POST http://localhost:8080/api/command \
  -H "Authorization: Bearer <PHONE_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text":"m1 ping","source":"iphone","request_id":"test-1"}'
```

Push update (single device):

```bash
curl -X POST http://localhost:8080/api/update \
  -H "Authorization: Bearer <PHONE_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"target":"m1","version":"0.2.0","package_url":"https://mpmc.ddns.net/updates/cordyceps-agent-0.2.0.exe"}'
```

Queue update for offline single device (dispatches on next reconnect):

```bash
curl -X POST http://localhost:8080/api/update \
  -H "Authorization: Bearer <PHONE_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"target":"m1","version":"0.2.0","package_url":"https://mpmc.ddns.net/updates/cordyceps-agent-0.2.0.exe","queue_if_offline":true}'
```

Notes:

- `sha256` is optional. If omitted, server downloads once and computes it before dispatch.
- `signature` + `signature_key_id` are optional unless `UPDATE_REQUIRE_SIGNATURE=true`, in which case both are required and verified server-side.
- `use_privileged_helper` is optional and only dispatches to agents advertising `privileged_helper_split`.
- Agent still verifies `sha256` locally before replacing itself.
- `queue_if_offline` is only valid when `target` is a single device ID (not `all`).

## Remote Propagation Workflow

1. Install this updater-capable agent build once on each PC (manual one-time step).
2. Build new `cordyceps-agent.exe` and host it at an HTTPS URL reachable by agents.
3. Open PWA `Agent Update` panel.
4. Fill:
   - target (`m1` or `all`)
   - version (for example `0.2.0`)
   - package URL (`https://.../cordyceps-agent-0.2.0.exe`)
   - optional SHA256 (leave blank to auto-inspect on server)
   - optional signature key ID + detached signature (required if signature hardening is enabled)
   - optional privileged helper toggle (for agents that advertise `privileged_helper_split`)
   - optional queue toggle for offline single-target updates
5. Tap `Push Update`.

Default behavior:

- server waits longer for update commands (`UPDATE_COMMAND_TIMEOUT_MS`, default 5 minutes)
- server rejects non-HTTPS package URLs unless `ENFORCE_HTTPS_UPDATE_URL=false`
- agent downloads, verifies hash, stages replacement, then restarts itself

## Built-in Guardrails

- no inbound ports required on Windows devices
- per-device token for agent WSS auth
- strict allowlisted command parsing
- no arbitrary shell/PowerShell from phone text
- remote update requires HTTPS URL (default) + SHA256 verification on agent
- optional/required detached signature verification on server prior to dispatch
- normal user context for main agent

## Automation (Self-Maintaining Colony)

This repo includes GitHub automation for CI, security scanning, dependency updates, release artifacts, and operational health checks:

- `.github/workflows/ci.yml`
- `.github/dependabot.yml`
- `.github/workflows/dependabot-auto-merge.yml`
- `.github/workflows/security.yml`
- `.github/workflows/release-agents.yml`
- `.github/workflows/ops-health.yml`

Configuration details (required variables/secrets, branch protection recommendations, optional code-signing) are documented in:

- [docs/automation.md](docs/automation.md)

## Recent Mutations / Completed Milestones

- signed package verification (phase 2 hardening)
- optional privileged helper split
- richer device/admin endpoints
- stronger token rotation UX
