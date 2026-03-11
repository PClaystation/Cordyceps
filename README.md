# Cordyceps Remote Device Control MVP

Phone-driven remote command system:

- iPhone Shortcut captures speech as text and sends it to server
- Built-in PWA client (`/app`) for iPhone/home-screen use
- Server parses and routes strict typed commands
- Windows agent receives typed command envelopes over outbound WSS
- Agent executes allowlisted actions only

## Implemented MVP Scope

- `POST /api/command` with deterministic parser and auth
- `POST /api/update` for one-button remote agent updates
- `GET /api/health`
- `POST /api/enroll` for first-run device enrollment
- `GET /api/devices` (phone-authenticated)
- PWA routes: `/app`, `/app.js`, `/app.css`, `/manifest.webmanifest`, `/sw.js`
- Agent WebSocket auth handshake + heartbeat
- Presence tracking (`online`/`offline` + `last_seen`)
- Request/response correlation with command timeout
- WebSocket auth timeout + ping keepalive + max-message-size guard
- Router backpressure + per-device command serialization
- Server-side package hash inspection (if `sha256` omitted on update requests)
- SQLite `devices` + `command_logs`
- Go agent with startup registration attempt (Windows task scheduler)
- Allowlisted agent actions:
  - `PING`
  - `OPEN_APP` (`spotify`, `discord`, `chrome`, `steam`, `explorer`, `vscode`, `edge`, `firefox`, `notepad`, `calculator`, `settings`, `slack`, `teams`, `taskmanager`, `terminal`, `powershell`, `cmd`, `controlpanel`, `paint`, `snippingtool`)
  - `MEDIA_PLAY`, `MEDIA_PAUSE`, `MEDIA_PLAY_PAUSE`, `MEDIA_NEXT`, `MEDIA_PREVIOUS`
  - `VOLUME_UP`, `VOLUME_DOWN`, `MUTE`
  - `LOCK_PC`
  - `NOTIFY`
  - `CLIPBOARD_SET`
  - `SYSTEM_SLEEP`, `SYSTEM_DISPLAY_OFF`, `SYSTEM_SIGN_OUT`, `SYSTEM_SHUTDOWN`, `SYSTEM_RESTART`
  - `AGENT_REMOVE` (local host must approve via multi-step prompt)
  - `EMERGENCY_LOCKDOWN` (implemented in `e1` agent family only)
  - Admin-only command family (implemented in `a1` agent family):
    - `ADMIN_EXEC_CMD`, `ADMIN_EXEC_POWERSHELL`
    - `PROCESS_LIST`, `PROCESS_KILL`
    - `SERVICE_LIST`, `SERVICE_CONTROL`
    - `FILE_READ`, `FILE_WRITE`, `FILE_APPEND`, `FILE_DELETE`, `FILE_LIST`, `FILE_MKDIR`
    - `SYSTEM_INFO`
  - `AGENT_UPDATE` (via `POST /api/update`)

## Repository Layout

- `server/` Node.js + TypeScript dispatcher
- `agent/` Go Windows agent (single binary)
- `t1/` Go Windows agent family (`t*` device IDs)
- `s1/` Go Windows safer agent family (`s*` device IDs, keeps updater but drops sleep/sign-out/shutdown/restart)
- `e1/` Go Windows agent family (`e*` device IDs, includes emergency lockdown command)
- `a1/` Go Windows admin agent family (`a*` device IDs, includes deep admin commands)
- `docs/iphone-shortcut.md` iPhone Shortcut wiring

## Command Language (Phone -> Server)

External format:

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
- `a1 admin service restart spooler`
- `a1 admin file read C:\Temp\notes.txt`
- `a1 admin file write C:\Temp\notes.txt :: hello from admin`
- `a1 admin system info`
- `m1 notify hello`
- `all ping`

Notes:

- parser lowercases and normalizes spaces
- `all` is intentionally restricted to `ping` in this MVP
- `volume up/down`, `next`, and `previous` support optional numeric repeats (`1-20`)
- app launch verbs supported: `open`, `launch`, `start`
- emergency command requires explicit confirmation (`panic confirm`, `lockdown confirm`, or `emergency confirm`)
- agent removal requires explicit remote confirmation (`remove agent confirm confirm`) and then local host approval on the target PC
- admin commands must use `admin ...` and are dispatched only to devices that advertise `admin_ops` capability (A1 family)

## Server Setup

1. Install Node.js 20+
2. Create env file:
   - `cp server/.env.example server/.env`
3. Optional: set values in `server/.env`:
   - `PUBLIC_WS_URL` (use `wss://...` behind TLS)
   - `PHONE_API_TOKEN` and `AGENT_BOOTSTRAP_TOKEN` (if omitted, they are auto-generated and persisted)
4. Optional hardening knobs:
   - `MAX_PENDING_COMMANDS`
   - `WS_AUTH_TIMEOUT_MS`
   - `WS_PING_INTERVAL_MS`
   - `WS_MAX_MESSAGE_BYTES`
   - `UPDATE_COMMAND_TIMEOUT_MS`
   - `UPDATE_METADATA_TIMEOUT_MS`
   - `UPDATE_MAX_PACKAGE_BYTES`
   - `ENFORCE_HTTPS_UPDATE_URL`
   - `CORS_ALLOWED_ORIGINS` (comma-separated explicit origins; defaults already include `https://pclaystation.github.io` and `https://mpmc.ddns.net`)
5. Install and run:

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
cd server
npm run show-config
```

Production:

- run behind TLS reverse proxy (Nginx/Caddy/Cloudflare Tunnel)
- expose HTTPS for `/api/*` and WSS for `/ws/agent`

## Agent Setup (Windows)

### Fastest way to add another device (T1 agent)

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

### Emergency-capable device family (E1 agent)

Use this on machines where you want remote panic mode with explicit confirmation (`panic confirm`, `lockdown confirm`, `emergency confirm`).

1. Build a USB-ready E1 agent once:

```powershell
cd e1
.\build-e1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `e1/dist/e1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\E1Agent\e1-agent.exe` and auto-designates `e*` IDs when `-DeviceId` is omitted.
`e1` keeps remote self-update support, but emergency execution is hardened with strict command gating, cooldown, local audit log, and automatic rollback of temporary network isolation.

Management:

- `.\manage-e1-agent.ps1 -Action status`
- `.\manage-e1-agent.ps1 -Action uninstall`

### Safer device family (S1 agent)

Use this on machines where you want the normal media/app/clipboard/notify/lock controls and remote self-update, but you do not want sleep, sign-out, shutdown, or restart exposed remotely.

1. Build a USB-ready S1 agent once:

```powershell
cd s1
.\build-s1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `s1/dist/s1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\S1Agent\s1-agent.exe` and auto-designates `s*` IDs when `-DeviceId` is omitted.
`s1` keeps remote self-update support, but its command handlers intentionally omit the more destructive power/session actions from `t1`.

Management:

- `.\manage-s1-agent.ps1 -Action status`
- `.\manage-s1-agent.ps1 -Action uninstall`

### Admin-capable device family (A1 agent)

Use this on machines where you want deep remote operations (process, service, file-system, and raw command execution).

1. Build a USB-ready A1 agent once:

```powershell
cd a1
.\build-a1-usb.ps1 -ServerUrl "https://your-server.example" -BootstrapToken "YOUR_BOOTSTRAP_TOKEN"
```

2. Run `a1/dist/a1-agent-usb.exe` once on the target device.

On first run it self-installs to `%LOCALAPPDATA%\A1Agent\a1-agent.exe` and auto-designates `a*` IDs when `-DeviceId` is omitted.
`a1` keeps remote self-update support and advertises `admin_ops` so server-side capability gates allow admin commands only on this family.

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
- attempts startup registration (Task Scheduler, then HKCU Run-key fallback)
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

## Native iOS App

A native SwiftUI iPhone app is available in:

- `ios/CordycepsRemote/`

Open `ios/CordycepsRemote/CordycepsRemote.xcodeproj` in Xcode and follow:

- [ios/CordycepsRemote/README.md](ios/CordycepsRemote/README.md)

## PWA Client (Recommended)

Open this URL on iPhone:

- `https://mpmc.ddns.net/app`

Then:

1. Preferred: open the `pwa_pairing_url` printed by server logs (auto-fills token, API, target, and default command/update target)
2. Or paste your `PHONE_API_TOKEN` in the app and tap `Save`
   - Set `API base URL` to your server origin (for same-host deployment this auto-fills)
3. Tap `Load Devices` to verify connectivity
4. Build/send commands directly from the app
5. Use the `Agent Update` panel to push updates by target + version + package URL
6. Optional: Share -> `Add to Home Screen` for app-like launch

Notes:

- Do not use `:8080` with HTTPS in the browser/PWA URL
- The token is stored in browser local storage on that device

### GitHub Pages Client

GitHub Pages can host the client only (not your Node server/agent).

1. Host the contents of `server/public/` on Pages
   - Included workflow: `.github/workflows/deploy-pages.yml`
   - In GitHub repo settings, set Pages source to `GitHub Actions`
2. In the client, set `API base URL` to `https://mpmc.ddns.net`
3. Server CORS:
   - Defaults already include `https://pclaystation.github.io` and `https://mpmc.ddns.net`
   - If you change domains later, set `CORS_ALLOWED_ORIGINS` accordingly

Detailed guide: [docs/github-pages.md](docs/github-pages.md)

## API Quick Test

Health:

```bash
curl http://localhost:8080/api/health
```

Phone command:

```bash
curl -X POST http://localhost:8080/api/command \
  -H "Authorization: Bearer YOUR_PHONE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"m1 ping","source":"iphone","request_id":"test-1"}'
```

Push update (single device):

```bash
curl -X POST http://localhost:8080/api/update \
  -H "Authorization: Bearer YOUR_PHONE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"m1","version":"0.2.0","package_url":"https://mpmc.ddns.net/updates/cordyceps-agent-0.2.0.exe"}'
```

Notes:

- `sha256` is optional. If omitted, server downloads once and computes it before dispatch.
- Agent still verifies `sha256` locally before replacing itself.

## Remote Update Workflow

1. Install this updater-capable agent build once on each PC (manual one-time step).
2. Build new `cordyceps-agent.exe` and host it at an HTTPS URL reachable by agents.
3. Open PWA `Agent Update` panel.
4. Fill:
   - target (`m1` or `all`)
   - version (for example `0.2.0`)
   - package URL (`https://.../cordyceps-agent-0.2.0.exe`)
   - optional SHA256 (leave blank to auto-inspect on server)
5. Tap `Push Update`.

Default behavior:

- server waits longer for update commands (`UPDATE_COMMAND_TIMEOUT_MS`, default 5 minutes)
- server rejects non-HTTPS package URLs unless `ENFORCE_HTTPS_UPDATE_URL=false`
- agent downloads, verifies hash, stages replacement, then restarts itself

## Security Defaults in This Build

- no inbound ports required on Windows devices
- per-device token for agent WSS auth
- strict allowlisted command parsing
- no arbitrary shell/PowerShell from phone text
- remote update requires HTTPS URL (default) + SHA256 verification on agent
- normal user context for main agent

## Known Gaps / Next Milestones

- signed package verification (phase 2 hardening)
- optional privileged helper split
- richer device/admin endpoints
- stronger token rotation UX
