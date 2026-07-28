#!/bin/bash
# Stop and remove the radio-scan launchd service. Logs/data are left in place.
set -euo pipefail
LABEL="com.radioscan"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. Data in ~/radio-scan-data (and ~/radio-scan) was kept."
else
  echo "No $LABEL service found."
fi
