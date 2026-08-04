#!/bin/bash
# ntune — hot-reload development build (Tauri dev server + native window).
# Same command on macOS and Linux.
#
#   scripts/dev.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install
exec npm run tauri dev
