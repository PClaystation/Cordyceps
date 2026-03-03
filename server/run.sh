#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed." >&2
  exit 1
fi

STAMP_FILE="node_modules/.install-stamp"
NEEDS_INSTALL=0

if [ ! -d node_modules ]; then
  NEEDS_INSTALL=1
elif [ ! -f "$STAMP_FILE" ]; then
  NEEDS_INSTALL=1
elif [ package.json -nt "$STAMP_FILE" ] || [ package-lock.json -nt "$STAMP_FILE" ]; then
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo "Installing dependencies..."
  npm install
  mkdir -p node_modules
  touch "$STAMP_FILE"
fi

echo "Starting Jarvis server..."
exec npm run dev
