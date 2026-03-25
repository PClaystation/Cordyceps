# Cordyceps Pesticide

Standalone Windows cleanup utility for known local Cordyceps/Jarvis agent artifacts.

It is intentionally narrow. It only targets:

- known agent process names
- known scheduled task names
- known Windows service names used by supported agent families
- known `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` values
- known `%LOCALAPPDATA%`, `%APPDATA%`, and `%PROGRAMDATA%` directories
- updater and relaunch leftovers in `%TEMP%`
- executable paths discovered from those exact tasks, services, run keys, and running agent processes

The current supported family scope is `agent`, `t1`, `s1`, `d1`, `ds1`, `se1`, `e1`, and `a1`.

## Build

From this folder on any machine with Go:

```bash
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=dev" -o dist/cordyceps-pesticide.exe ./cmd/pesticide
```

PowerShell:

```powershell
.\build-pesticide.ps1 -Version "0.1.0"
```

The PowerShell build script now produces a GUI-subsystem EXE by default, so on the target device it behaves like a normal app when you double-click it. If you want a console build for debugging, add `-Console`.

## Run

Double-click use:

- If you launch `cordyceps-pesticide.exe` with no arguments, it opens confirmation/result dialogs.
- If no known artifacts are found, it tells you and exits.
- If artifacts are found, it asks for confirmation, cleans them, then shows the result.

Optional terminal use:

Inspect first:

```powershell
.\cordyceps-pesticide.exe -mode inspect
```

Preview cleanup without changing the host:

```powershell
.\cordyceps-pesticide.exe -mode clean -dry-run
```

Clean all known strains:

```powershell
.\cordyceps-pesticide.exe -mode clean
```

Clean only selected strains:

```powershell
.\cordyceps-pesticide.exe -mode clean -scope t1,e1
```
