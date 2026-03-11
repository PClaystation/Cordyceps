# Agent Strains

Cordyceps has five intentionally distinct agent strains:

- `s` (`s*` device IDs): lite profile for users who want only basic remote control and no emergency lockdown.
- `se` (`se*` device IDs): `s` + emergency lockdown security features.
- `t` (`t*` device IDs): regular full remote control profile.
- `e` (`e*` device IDs): `t` + emergency lockdown + stricter local security model.
- `a` (`a*` device IDs): admin profile with broad operations and deep system tooling.

## Strain Command Surface Matrix

### `s` (lite)

- Includes: `PING`, media, volume, `OPEN_APP`, `LOCK_PC`, `NOTIFY`, `CLIPBOARD_SET`, `SYSTEM_DISPLAY_OFF`, `AGENT_UPDATE`.
- Excludes: `SYSTEM_SLEEP`, `SYSTEM_SIGN_OUT`, `SYSTEM_SHUTDOWN`, `SYSTEM_RESTART`, `AGENT_REMOVE`, `EMERGENCY_LOCKDOWN`, admin commands.

### `se` (lite + emergency)

- Includes: everything in `s` + `EMERGENCY_LOCKDOWN`.
- Excludes: `SYSTEM_SLEEP`, `SYSTEM_SIGN_OUT`, `SYSTEM_SHUTDOWN`, `SYSTEM_RESTART`, `AGENT_REMOVE`, admin commands.

### `t` (standard)

- Includes: everything in `s` + `SYSTEM_SLEEP`, `SYSTEM_SIGN_OUT`, `SYSTEM_SHUTDOWN`, `SYSTEM_RESTART`, `AGENT_REMOVE`.
- Excludes: `EMERGENCY_LOCKDOWN`, admin commands.

### `e` (standard + secure emergency)

- Includes: everything in `t` + `EMERGENCY_LOCKDOWN`.
- Security model: explicit local command allowlist, emergency cooldown, persisted emergency-active state, and emergency-mode blocking for non-emergency commands.
- Excludes: admin command family.

### `a` (admin)

- Includes: everything in `t` plus admin command family (`admin cmd`, `admin ps`, process/service/file/network/event-log/environment/system-info operations).
- Intended as full-control profile.

## Capabilities

Each strain family advertises a profile capability marker:

- `s`: `profile_s`
- `se`: `profile_se`
- `t`: `profile_t`
- `e`: `profile_e`
- `a`: `profile_a`

The server uses these markers (with device ID prefix fallback) to enforce strain-specific command routing policy.
