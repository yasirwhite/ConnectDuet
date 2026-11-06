#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24 LTS or newer from https://nodejs.org then reopen this launcher.'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  printf '%s\n' 'Node.js 24 or newer is required. Update from https://nodejs.org'
  exit 1
fi
if [ ! -f node_modules/@modelcontextprotocol/sdk/package.json ]; then
  npm ci --omit=dev --ignore-scripts
fi
exec node src/launcher.mjs
