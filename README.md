# Jarvis Remote Device Control MVP

Phone-driven remote command system:

- iPhone Shortcut captures speech as text and sends it to server
- Built-in PWA client (`/app`) for iPhone/home-screen use
- Server parses and routes strict typed commands
- Windows agent receives typed command envelopes over outbound WSS
- Agent executes allowlisted actions only

## Implemented MVP Scope

- `POST /api/command` with deterministic parser and auth
- `GET /api/health`
- `POST /api/enroll` for first-run device enrollment
- `GET /api/devices` (phone-authenticated)
- PWA routes: `/app`, `/app.js`, `/app.css`, `/manifest.webmanifest`, `/sw.js`
- Agent WebSocket auth handshake + heartbeat
- Presence tracking (`online`/`offline` + `last_seen`)
- Request/response correlation with command timeout
- WebSocket auth timeout + ping keepalive + max-message-size guard
- Router backpressure + per-device command serialization
- SQLite `devices` + `command_logs`
- Go agent with startup registration attempt (Windows task scheduler)
- Allowlisted agent actions:
  - `PING`
  - `OPEN_APP` (`spotify`, `discord`, `chrome`)
  - `MEDIA_PLAY`, `MEDIA_PAUSE`, `MEDIA_NEXT`, `MEDIA_PREVIOUS`
  - `VOLUME_UP`, `VOLUME_DOWN`, `MUTE`
  - `LOCK_PC`
  - `NOTIFY`

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
- `m2 volume up`
- `m3 lock`
- `m1 notify hello`
- `all ping`

Notes:

- parser lowercases and normalizes spaces
- `all` is intentionally restricted to `ping` in this MVP

## Server Setup

1. Install Node.js 20+
2. Create env file:
   - `cp server/.env.example server/.env`
3. Set required secrets in `server/.env`:
   - `PHONE_API_TOKEN`
   - `AGENT_BOOTSTRAP_TOKEN`
   - `PUBLIC_WS_URL` (use `wss://...` behind TLS)
4. Optional hardening knobs:
   - `MAX_PENDING_COMMANDS`
   - `WS_AUTH_TIMEOUT_MS`
   - `WS_PING_INTERVAL_MS`
   - `WS_MAX_MESSAGE_BYTES`
5. Install and run:

```bash
cd server
npm install
npm run dev
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

What first run does:

- enrolls via `/api/enroll`
- stores long-lived device token in user config
- attempts startup registration (Task Scheduler, then HKCU Run-key fallback)
- starts outbound WebSocket session

Default config path on Windows:

- `%APPDATA%\JarvisAgent\config.json`

## iPhone Shortcut

See [docs/iphone-shortcut.md](docs/iphone-shortcut.md).

## PWA Client (Recommended)

Open this URL on iPhone:

- `https://mpmc.ddns.net/app`

Then:

1. Paste your `PHONE_API_TOKEN` in the app and tap `Save`
2. Tap `Load Devices` to verify connectivity
3. Build/send commands directly from the app
4. Optional: Share -> `Add to Home Screen` for app-like launch

Notes:

- Do not use `:8080` with HTTPS in the browser/PWA URL
- The token is stored in browser local storage on that device

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

## Security Defaults in This Build

- no inbound ports required on Windows devices
- per-device token for agent WSS auth
- strict allowlisted command parsing
- no arbitrary shell/PowerShell from phone text
- normal user context for main agent

## Known Gaps / Next Milestones

- signed remote update flow (phase 2)
- optional privileged helper split
- richer device/admin endpoints
- stronger token rotation UX
