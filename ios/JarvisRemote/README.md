# JarvisRemote iOS App

Native SwiftUI client for controlling Jarvis agents from iPhone.

## What it supports

- Full command-library parity with the PWA:
  - Searchable action catalog with aliases and categories
  - Repeatable action arguments (`volume up 3`, `next 2`, etc.)
  - Dangerous-action highlighting
- Save API base URL + `PHONE_API_TOKEN`
- Test token and load devices with live connection state (`Connected`, `Retrying`, `Disconnected`)
- Auto-refresh device presence every 30 seconds
- Select target from device cards
- Build/send typed commands through `POST /api/command`
- Voice dictation for command text (`Speak` button)
- Pairing-link import (paste `pwa_pairing_url` / external pairing URL and auto-fill settings)
- Send update payloads through `POST /api/update`
- Rich result panel:
  - status
  - request ID
  - latency
  - server message + raw JSON
- Persist connection, action, success timestamp, and update defaults in local app storage

## Open in Xcode

1. Open `ios/JarvisRemote/JarvisRemote.xcodeproj`
2. Select target `JarvisRemote`
3. Set your signing team and bundle id (if needed)
4. Run on an iPhone simulator or physical iPhone

## Server configuration

Set these inside the app:

- API base URL: your Jarvis server origin (example `https://mpmc.ddns.net`)
- Token: `PHONE_API_TOKEN` value from your server

Then tap `Load` to fetch devices.

## Notes

- This app talks to the same server endpoints used by the web PWA.
- The app requests microphone + speech recognition permissions only when `Speak` is used.
- If your server is HTTPS and the app cannot connect, confirm the host is reachable from iPhone and token is correct.
