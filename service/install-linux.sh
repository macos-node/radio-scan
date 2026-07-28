#!/bin/bash
# Install radio-scan as a systemd *user* service on Linux (runs 24/7).
#
#   ./install-linux.sh
#
# Edit ~/radio-scan/config.json to add stations, then:
#   systemctl --user restart radio-scan
set -euo pipefail

APP_DIR="$HOME/radio-scan"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
PY="$(command -v python3 || true)"

[ -n "$PY" ] || { echo "ERROR: python3 not found." >&2; exit 1; }

mkdir -p "$APP_DIR" "$UNIT_DIR"
cp "$REPO_DIR/radioscan.py" "$APP_DIR/radioscan.py"
if [ ! -f "$APP_DIR/config.json" ]; then
  cp "$REPO_DIR/config.example.json" "$APP_DIR/config.json"
  echo "Seeded $APP_DIR/config.json (edit it to add your stations)."
fi

cat > "$UNIT_DIR/radio-scan.service" <<UNITEOF
[Unit]
Description=radio-scan playlist logger
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$PY $APP_DIR/radioscan.py run --config $APP_DIR/config.json
Restart=always
RestartSec=15
WorkingDirectory=$APP_DIR

[Install]
WantedBy=default.target
UNITEOF

systemctl --user daemon-reload
systemctl --user enable --now radio-scan.service
echo "Installed and started (systemctl --user status radio-scan)."
echo "Tip: 'sudo loginctl enable-linger $USER' keeps it running when you're logged out."
