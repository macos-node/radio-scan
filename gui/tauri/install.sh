#!/bin/bash
# Build ntune and install it to /Applications, then relaunch — the ntune analog
# of RadioBar's `build-app.sh --install`. macOS only (produces a .app bundle;
# `tauri build` also leaves a .dmg alongside it).
#
#   ./install.sh               # build (release) + quit + install + relaunch
#   ./install.sh --skip-build  # reinstall the last build without rebuilding
#
# Or via npm:  npm run install:app
#
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "install.sh is macOS-only (installs a .app to /Applications)." >&2
  exit 1
fi

APP_NAME="ntune.app"
BUILT="src-tauri/target/release/bundle/macos/$APP_NAME"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "--- Building ntune (release) ---"
  npm run tauri build
fi

if [[ ! -d "$BUILT" ]]; then
  echo "No built app at $BUILT — run without --skip-build first." >&2
  exit 1
fi

echo "--- Quitting running ntune (if any) ---"
osascript -e 'quit app "ntune"' 2>/dev/null || pkill -x ntune 2>/dev/null || true
sleep 1

echo "--- Installing to /Applications ---"
rm -rf "/Applications/$APP_NAME"
cp -R "$BUILT" "/Applications/$APP_NAME"

echo "--- Relaunching ---"
open "/Applications/$APP_NAME"

VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "/Applications/$APP_NAME/Contents/Info.plist" 2>/dev/null || echo "?")
echo "Installed + relaunched: /Applications/$APP_NAME (v$VER)"
