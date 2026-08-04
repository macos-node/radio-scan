#!/bin/bash
# ntune — build a local release bundle and install it for the CURRENT OS.
# One command, native output per platform ("the same app, localized"):
#   macOS  -> ntune.app         installed to /Applications
#   Linux  -> ntune .AppImage   installed to ~/Applications  (no sudo)
#
# Distributable bundles (.dmg / .deb) are produced by CI (release.yml) on a
# tag; this script builds only what a local install needs.
#
#   scripts/build-install.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install

os="$(uname -s)"
case "$os" in
  Darwin)
    npm run tauri build -- --bundles app
    APP="src-tauri/target/release/bundle/macos/ntune.app"
    [ -d "$APP" ] || { echo "ERROR: $APP not found after build" >&2; exit 1; }
    echo "--- Installing ntune.app -> /Applications ---"
    rm -rf /Applications/ntune.app
    cp -R "$APP" /Applications/
    echo "Installed: /Applications/ntune.app  (open it from Spotlight / Launchpad)"
    ;;
  Linux)
    # Needs-verify: linux (AppImage path + ~/Applications install — authored on macOS)
    npm run tauri build -- --bundles appimage
    IMG="$(ls -t src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1 || true)"
    [ -n "$IMG" ] || { echo "ERROR: no .AppImage found after build" >&2; exit 1; }
    mkdir -p "$HOME/Applications"
    DEST="$HOME/Applications/ntune.AppImage"
    cp "$IMG" "$DEST"
    chmod +x "$DEST"
    echo "Installed: $DEST  (run it directly; for a system install use the .deb from CI)"
    ;;
  *)
    echo "Unsupported OS: $os" >&2
    exit 1
    ;;
esac
