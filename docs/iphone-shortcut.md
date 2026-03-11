# iPhone Shortcut Spore Setup

Build a Shortcut that captures spoken commands and sends them into the colony via `POST /api/command`.

## Shortcut Chain

1. `Dictate Text` (or `Ask for Input`)
2. `Set Variable` -> `commandText`
3. `Get Contents of URL`
   - URL: `https://YOUR_SERVER_DOMAIN/api/command`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer YOUR_PHONE_API_TOKEN`
     - `Content-Type: application/json`
   - Request Body: `JSON`

JSON body fields:

- `text` = `commandText`
- `source` = `iphone`
- `client_version` = `shortcut-v1`
- `request_id` = `Current Date` + random suffix (or UUID action if available)

4. `Show Result`
   - Show `message` from response JSON

## Expected Success Responses

- `m1 is online`
- `Opened spotify`
- `Volume up command sent`

## Expected Error Responses

- `Unknown device: m9`
- `m2 is offline`
- `Command rejected: Unknown command: dance`
- `m1 did not respond in time`

## Field Tip

Create one home-screen button shortcut and keep phrases explicit, for example:

- `m1 open spotify`
- `m1 pause`
- `m1 open vscode`
- `m2 volume down 4`
- `m1 play pause`
- `m1 shutdown`
- `m3 lock`

Strain reference: see [agent-profiles.md](./agent-profiles.md) for the canonical `s` / `se` / `t` / `e` / `a` behavior matrix.
