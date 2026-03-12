# Colony Automation Guide

This repo includes the following GitHub automation workflows to keep the colony healthy:

- `.github/workflows/ci.yml`
  - PR/main checks for:
    - `server`: `npm run typecheck`, `npm test`
    - Go modules: `go test ./...` and `go vet ./...` in `agent`, `t1`, `s1`, `e1`, `se1`, `a1`

- `.github/dependabot.yml`
  - Weekly dependency update PRs for:
    - `server` npm dependencies
    - every Go module
    - GitHub Actions versions

- `.github/workflows/dependabot-auto-merge.yml`
  - Enables auto-merge for Dependabot PRs that are semver patch/minor updates.
  - Actual merge still respects branch protection and required checks.

- `.github/workflows/security.yml`
  - Pull request + scheduled security checks:
    - CodeQL (`javascript-typescript`, `go`)
    - `npm audit` (prod deps, high+)
    - `govulncheck` across all Go modules
    - `gitleaks` secret scan
    - Dependency Review on PRs

- `.github/workflows/release-agents.yml`
  - Builds Windows agent binaries for all agent families on tag push (`v*`) or manual dispatch.
  - Publishes release artifacts:
    - `*.exe`
    - `SHA256SUMS.txt`
    - `release-manifest.json`
  - Optional code-signing if secrets are configured.

- `.github/workflows/ops-health.yml`
  - Runs every 15 minutes (and manually) against `/api/health`.
  - Fails on unhealthy status or threshold breaches, and can post alerts to Discord/Slack.

## Required Repository Settings

For a low-maintenance, self-sustaining setup, configure branch protection for `main` to require at least:

- `CI / Server (typecheck + test)`
- `CI / Go (...)` matrix jobs
- `Security` workflow jobs you want as required gates

## Colony Health Check Configuration

Configure these in GitHub repo settings:

Repository variables:

- `CORDYCEPS_HEALTH_URL` (example: `https://your-domain.example/api/health`)
- `CORDYCEPS_MIN_DEVICES_ONLINE` (optional, default `1`)
- `CORDYCEPS_MAX_PENDING_COMMANDS` (optional, default `100`)

Repository secrets:

- `CORDYCEPS_HEALTH_BEARER_TOKEN` (optional, if health endpoint requires auth)
- `CORDYCEPS_DISCORD_WEBHOOK_URL` (optional)
- `CORDYCEPS_SLACK_WEBHOOK_URL` (optional)

## Optional Agent Signing Configuration

If you want release binaries signed in CI, set repository secrets:

- `WINDOWS_SIGN_CERT_PFX_B64` (base64-encoded PFX cert)
- `WINDOWS_SIGN_CERT_PASSWORD`

If these are not set, release builds still run and publish unsigned artifacts.

## Binary Artifact Policy

Built release `.exe` files and generated release manifests should be published via Releases/artifacts, not committed to git.

The repository `.gitignore` ignores local module `.exe` files, generated `release/*` artifacts, all `*/dist/` outputs, and any `*-agent-usb.exe` bootstrap binary.
