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
# Each run passes --all, so the first one backfills the archive and every later
# one closes any gap a missed or failed week left. It used to fetch only the
# LATEST episode, which made one bad week a permanent hole — that is exactly how
# 2026-08-22 went missing on the Linux box. Re-walking the feed is cheap and
# safe: the parsers de-duplicate by episode title (duck ~3s, otw ~2m).
# --clean runs after, because *_log.clean.* is derived and goes stale otherwise.
set -euo pipefail

APP_DIR="$HOME/radio-scan"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
DATA_DIR="${RADIOSCAN_DATA:-$HOME/radio-scan-data}"
PY="$(command -v python3 || true)"

[ -n "$PY" ] || { echo "ERROR: python3 not found." >&2; exit 1; }

mkdir -p "$APP_DIR/episodic" "$UNIT_DIR" "$DATA_DIR"
cp "$REPO_DIR/episodic/otw_playlist.py" "$REPO_DIR/episodic/duck_playlist.py" "$APP_DIR/episodic/"

# name | script | OnCalendar | host to wait for | description
while IFS='|' read -r name script cal host desc; do
  cat > "$UNIT_DIR/$name.service" <<UNITEOF
[Unit]
Description=$desc
# NOT network-online.target. That is a SYSTEM target and means nothing in a user
# unit — it looks like a network guard and is silently a no-op. Combined with
# Persistent=true (which fires a missed weekly run at login, before DNS is up)
# and Type=oneshot (which cannot carry Restart=), every catch-up run died on
# "Temporary failure in name resolution" and the week was lost. Wait for real
# resolution instead.

[Service]
Type=oneshot
ExecStartPre=/usr/bin/timeout 300 /bin/sh -c 'until getent hosts $host >/dev/null 2>&1; do sleep 5; done'
ExecStart=$PY $APP_DIR/episodic/$script --all --data-dir $DATA_DIR
ExecStartPost=$PY $APP_DIR/episodic/$script --clean --data-dir $DATA_DIR
# The DNS wait is capped at 300s by \`timeout\` above; this covers the whole start
# sequence, and a full --all fetch runs for minutes, so it is deliberately loose.
TimeoutStartSec=1800
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
otw-playlist|otw_playlist.py|Mon 09:00|otwradio.blogspot.com|On The Wire playlist parser
duck-playlist|duck_playlist.py|Wed 09:00|feed.podbean.com|A Duck in a Tree tracklist parser
JOBS

systemctl --user daemon-reload
systemctl --user enable --now otw-playlist.timer duck-playlist.timer

echo "Installed. Next runs:"
systemctl --user list-timers otw-playlist.timer duck-playlist.timer --no-pager || true
cat <<TIPS

Logs land in $DATA_DIR/{otw,duck}/ — raw *_log.jsonl plus the derived
*_log.clean.* the run regenerates. No separate backfill step: each run passes
--all, so the first one pulls the archive.
Run one now without waiting for its day:
    systemctl --user start otw-playlist.service && journalctl --user -u otw-playlist -n 20
Keep timers running when logged out:
    sudo loginctl enable-linger $USER
TIPS
