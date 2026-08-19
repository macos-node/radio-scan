#!/bin/bash
# Install the episodic playlist parsers as systemd *user* timers on Linux.
#
#   ./install-linux-episodic.sh
#
# Two weekly one-shots, the Linux equivalent of the macOS launchd jobs they came
# from (com.tigger.otwradio / com.tigger.duckradio):
#
#   On The Wire      Mon 09:00   Blogger feed, one post per episode
#   A Duck in a Tree Wed 09:00   Podbean feed, whole archive in one document
#
# These are TIMERS, not the always-on service install-linux.sh sets up for live
# streams: an episodic show publishes its tracklist once, so there is nothing to
# catch live. Persistent=true runs a missed week after the machine was off —
# launchd's RunAtLoad only fired at login, so a week powered down was skipped.
#
# Backfill is not automatic. The timer fetches the latest episode; run once with
# --all first if you want the archive (see the hint printed at the end).
set -euo pipefail

APP_DIR="$HOME/radio-scan"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
DATA_DIR="${RADIOSCAN_DATA:-$HOME/radio-scan-data}"
PY="$(command -v python3 || true)"

[ -n "$PY" ] || { echo "ERROR: python3 not found." >&2; exit 1; }

mkdir -p "$APP_DIR/episodic" "$UNIT_DIR" "$DATA_DIR"
cp "$REPO_DIR/episodic/otw_playlist.py" "$REPO_DIR/episodic/duck_playlist.py" "$APP_DIR/episodic/"

# name | script | OnCalendar | description
while IFS='|' read -r name script cal desc; do
  cat > "$UNIT_DIR/$name.service" <<UNITEOF
[Unit]
Description=$desc
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$PY $APP_DIR/episodic/$script --data-dir $DATA_DIR
WorkingDirectory=$APP_DIR
UNITEOF

  cat > "$UNIT_DIR/$name.timer" <<TIMEREOF
[Unit]
Description=$desc (weekly)

[Timer]
OnCalendar=$cal
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF
done <<'JOBS'
otw-playlist|otw_playlist.py|Mon 09:00|On The Wire playlist parser
duck-playlist|duck_playlist.py|Wed 09:00|A Duck in a Tree tracklist parser
JOBS

systemctl --user daemon-reload
systemctl --user enable --now otw-playlist.timer duck-playlist.timer

echo "Installed. Next runs:"
systemctl --user list-timers otw-playlist.timer duck-playlist.timer --no-pager || true
cat <<TIPS

Logs land in $DATA_DIR/{otw,duck}/.
Backfill the archives once (each is a single pass, then the timers keep up):
    python3 $APP_DIR/episodic/otw_playlist.py  --all --data-dir $DATA_DIR
    python3 $APP_DIR/episodic/duck_playlist.py --all --data-dir $DATA_DIR
Run one now without waiting for its day:
    systemctl --user start otw-playlist.service && journalctl --user -u otw-playlist -n 20
Keep timers running when logged out:
    sudo loginctl enable-linger $USER
TIPS
