# CordycepsRemote iOS Field App

Native SwiftUI field client for directing Cordyceps nodes from iPhone.

## What it supports

- Fungus-themed Cordyceps UI rebrand (`Cordyceps Bloom`) with a custom app icon + accent color
- Command-library parity with the PWA:
  - Searchable actions with aliases and category grouping
  - Repeatable action arguments (`volume up 3`, `next 2`)
  - Dangerous-action warning + explicit confirmation dialog
- Save API base URL + `PHONE_API_TOKEN`
- Token test + live connection state (`Connected`, `Retrying`, `Disconnected`)
- Device list auto-refresh every 30 seconds while app is active
- Device search and online-only filter
- Select target from device cards
- Build/send typed commands through `POST /api/command`
- Recent command history chips (reuse and clear)
- Voice dictation for command text (`Speak`)
- Pairing-link import (paste `pwa_pairing_url` / external pairing URL and auto-fill settings)
- Send update payloads through `POST /api/update`
- Rich result panel:
  - status
  - request ID
  - latency
  - server message + raw JSON
- Persist connection/action/update defaults and recent command history in local storage

## Requirements

- Xcode 16+
- iOS 16.0+ device

## Install on iPhone

1. Open `ios/CordycepsRemote/CordycepsRemote.xcodeproj` in Xcode.
2. Select target `CordycepsRemote`.
3. In `Signing & Capabilities`, choose your Apple Team and set a unique bundle identifier if needed.
4. Plug in your iPhone (or pair wirelessly) and choose it as the run destination.
5. Build and Run (`Cmd+R`).

### If install/download to phone fails

1. Confirm the iPhone is on iOS 16 or newer.
2. Enable `Settings -> Privacy & Security -> Developer Mode` on iPhone.
3. Trust your developer certificate on device (`Settings -> General -> VPN & Device Management`) if prompted.
4. Use your own team + bundle id in Xcode (do not rely on placeholder values from repo).
5. Clean build folder (`Shift+Cmd+K`) and rerun.

## Server configuration

Set these inside the app:

- API base URL: your Cordyceps server origin (example `https://mpmc.ddns.net`)
- Token: `PHONE_API_TOKEN` value from your server

Then tap `Load` to fetch devices.

## Notes

- This app talks to the same server endpoints used by the web PWA.
- Agent strain model is documented in `/docs/agent-profiles.md`:
  - `s` = lite/basic strain
  - `se` = lite + emergency lockdown strain
  - `t` = regular remote-control strain
  - `e` = regular + emergency + stricter security strain
  - `a` = admin/widest control-surface strain
- The app requests microphone + speech recognition permissions only when `Speak` is used.
- If your server cannot connect, confirm host reachability from iPhone and token validity.
- iOS ATS still expects secure (HTTPS) remote endpoints. Local-network HTTP targets may require additional ATS exceptions depending on your setup.
