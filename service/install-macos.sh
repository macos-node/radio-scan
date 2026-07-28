#!/bin/bash
# Install radio-scan as a macOS launchd service (runs 24/7, restarts on reboot).
#
#   ./install-macos.sh              # installs, seeding config from config.example.json
#
# Edit ~/radio-scan/config.json to add stations, then re-run this script (or the
# restart line it prints) to pick up changes.
set -euo pipefail

LABEL="com.radioscan"
APP_DIR="$HOME/radio-scan"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$(command -v python3 || true)"

[ -n "$PY" ] || { echo "ERROR: python3 not found. Install it and re-run." >&2; exit 1; }

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents"
cp "$REPO_DIR/radioscan.py" "$APP_DIR/radioscan.py"
if [ ! -f "$APP_DIR/config.json" ]; then
  cp "$REPO_DIR/config.example.json" "$APP_DIR/config.json"
  echo "Seeded $APP_DIR/config.json (edit it to add your stations)."
fi

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>             <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PY</string>
        <string>$APP_DIR/radioscan.py</string>
        <string>run</string>
        <string>--config</string>
        <string>$APP_DIR/config.json</string>
    </array>
    <key>RunAtLoad</key>         <true/>
    <key>KeepAlive</key>        <true/>
    <key>ThrottleInterval</key> <integer>15</integer>
    <key>WorkingDirectory</key> <string>$APP_DIR</string>
    <key>StandardOutPath</key>  <string>$APP_DIR/service.out.log</string>
    <key>StandardErrorPath</key><string>$APP_DIR/service.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed and started ($LABEL)."
echo "  Config : $APP_DIR/config.json"
echo "  Data   : see data_dir in the config (default ~/radio-scan-data)"
echo "  Restart after editing config:"
echo "    launchctl kickstart -k gui/\$(id -u)/$LABEL"
