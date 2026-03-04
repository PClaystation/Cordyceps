# Jarvis Remote Device Control MVP

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
  - `SYSTEM_SLEEP`, `SYSTEM_SHUTDOWN`, `SYSTEM_RESTART`
  - `AGENT_UPDATE` (via `POST /api/update`)

## Repository Layout

- `server/` Node.js + TypeScript dispatcher
- `agent/` Go Windows agent (single binary)
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
- `m1 open vscode`
- `m1 open task manager`
- `m1 open terminal`
- `m1 open powershell`
- `m1 restart`
- `m1 notify hello`
- `all ping`

Notes:

- parser lowercases and normalizes spaces
- `all` is intentionally restricted to `ping` in this MVP
- `volume up/down`, `next`, and `previous` support optional numeric repeats (`1-20`)
- app launch verbs supported: `open`, `launch`, `start`

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

1. Install Go 1.23+ or build on another machine and copy exe
2. Build:

```bash
cd agent
go build -o jarvis-agent.exe ./cmd/agent
```

3. First-run enrollment:

```powershell
.\jarvis-agent.exe --server-url "https://your-server.example" --device-id "m1" --bootstrap-token "YOUR_BOOTSTRAP_TOKEN"
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

- `%APPDATA%\JarvisAgent\config.json`

## iPhone Shortcut

See [docs/iphone-shortcut.md](docs/iphone-shortcut.md).

## Native iOS App

A native SwiftUI iPhone app is available in:

- `ios/JarvisRemote/`

Open `ios/JarvisRemote/JarvisRemote.xcodeproj` in Xcode and follow:

- [ios/JarvisRemote/README.md](ios/JarvisRemote/README.md)

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
  -d '{"target":"m1","version":"0.2.0","package_url":"https://mpmc.ddns.net/updates/jarvis-agent-0.2.0.exe"}'
```

Notes:

- `sha256` is optional. If omitted, server downloads once and computes it before dispatch.
- Agent still verifies `sha256` locally before replacing itself.

## Remote Update Workflow

1. Install this updater-capable agent build once on each PC (manual one-time step).
2. Build new `jarvis-agent.exe` and host it at an HTTPS URL reachable by agents.
3. Open PWA `Agent Update` panel.
4. Fill:
   - target (`m1` or `all`)
   - version (for example `0.2.0`)
   - package URL (`https://.../jarvis-agent-0.2.0.exe`)
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
