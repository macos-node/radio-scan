#!/usr/bin/env python3
"""
acidjazz_radio.py  -  a tiny radio "tuner" that logs what an Icecast/Shoutcast
stream is playing, then organises it into daily / weekly summaries.

No third-party packages required (Python 3.8+ standard library only).

Usage:
    python3 acidjazz_radio.py test          # one-off: show the current track + how it was found
    python3 acidjazz_radio.py run           # run forever, logging every track change (this is what the service runs)
    python3 acidjazz_radio.py stats         # print an all-time summary from the existing log
    python3 acidjazz_radio.py resummarize   # rebuild every summary file from the raw log

Environment overrides (optional):
    ACIDJAZZ_URL      stream URL           (default below)
    ACIDJAZZ_HOME     where logs are kept  (default: ~/RadioTuner)
"""

import os
import re
import csv
import sys
import json
import time
import signal
import socket
import urllib.request
from datetime import datetime, timezone
from collections import Counter, defaultdict

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
STREAM_URL = os.environ.get("ACIDJAZZ_URL", "http://79.111.14.76:8000/acidjazz")
HOME_DIR   = os.path.expanduser(os.environ.get("ACIDJAZZ_HOME", "~/RadioTuner"))

LOG_JSONL  = os.path.join(HOME_DIR, "acidjazz_log.jsonl")   # source of truth, one line per track change
LOG_CSV    = os.path.join(HOME_DIR, "acidjazz_log.csv")     # same data, human-friendly
SUMMARY_DIR = os.path.join(HOME_DIR, "summaries")
LATEST_TXT = os.path.join(SUMMARY_DIR, "latest.txt")
STATION_INFO = os.path.join(HOME_DIR, "station_info.txt")   # what the station advertises about itself

USER_AGENT = "acidjazz-radio-tuner/1.0 (personal playlist logger)"
RECONNECT_MIN = 5      # seconds; backoff starts here
RECONNECT_MAX = 120    # seconds; backoff caps here
POLL_INTERVAL = 20     # seconds; only used by the status.json fallback path

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def ensure_dirs():
    os.makedirs(HOME_DIR, exist_ok=True)
    os.makedirs(SUMMARY_DIR, exist_ok=True)


def now_pair():
    """Return (utc_iso, local_iso, epoch)."""
    n = datetime.now(timezone.utc)
    local = n.astimezone()
    return n.isoformat(timespec="seconds"), local.isoformat(timespec="seconds"), n.timestamp()


def decode_bytes(b):
    """ICY metadata can be UTF-8, or (on many Russian servers) Windows-1251, or Latin-1."""
    for enc in ("utf-8", "cp1251", "latin-1"):
        try:
            return b.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return b.decode("utf-8", errors="replace")


def parse_stream_title(raw):
    """Split 'Artist - Title' into (artist, title). Best-effort; keeps the raw string too."""
    raw = (raw or "").strip()
    if " - " in raw:
        artist, title = raw.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", raw


def read_exactly(fp, n):
    """Read exactly n bytes from a file-like object, or fewer only at EOF."""
    chunks = []
    remaining = n
    while remaining > 0:
        chunk = fp.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Metadata acquisition
# ---------------------------------------------------------------------------

# The live stream response, so the SIGTERM handler can close it out from under a
# blocked read. Checking a stop flag between metaint blocks is not enough on its
# own: when the socket STALLS the process sits inside read_exactly() and never
# reaches the check, for up to the 20s urlopen timeout below — and launchd's
# ExitTimeOut is also ~20s, so the shutdown raced the kill timer and lost.
# Observed 2026-08-25 13:52:06, one minute after a "timed out; reconnecting"
# line: signal handled, no "stopped.", killed. Closing the response makes the
# blocked read raise at once; the caller sees stop["flag"] and exits cleanly.
_LIVE_RESP = {"resp": None}


def open_stream(url):
    req = urllib.request.Request(url, headers={
        "Icy-MetaData": "1",
        "User-Agent": USER_AGENT,
        "Connection": "keep-alive",
    })
    resp = urllib.request.urlopen(req, timeout=20)
    _LIVE_RESP["resp"] = resp
    return resp


def write_station_info(headers):
    """Dump what the station advertises (name, genre, bitrate, url, ...) so we can
    see exactly what metadata this stream provides. Overwritten on each connect."""
    preferred = ["icy-name", "icy-genre", "icy-description", "icy-url",
                 "icy-br", "icy-sr", "icy-pub", "icy-metaint",
                 "content-type", "server"]
    try:
        lines, seen = [], set()
        for k in preferred:
            v = headers.get(k)
            if v:
                lines.append(f"{k}: {v}")
                seen.add(k.lower())
        for k, v in headers.items():             # any other icy-* fields we didn't list
            if k.lower().startswith("icy-") and k.lower() not in seen:
                lines.append(f"{k}: {v}")
        with open(STATION_INFO, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except Exception:
        pass


def icy_title_generator(url, stop=None):
    """
    Open the audio stream and yield a dict every time the track changes:
        {"title": "...", "url": "...", "meta_raw": "..."}
    'url' is the per-track StreamUrl if the station sends one (often empty).
    'meta_raw' is the full metadata block, so we can spot any extra fields.
    Raises RuntimeError if the server sends no icy-metaint (no inline metadata).

    `stop` is the caller's {"flag": bool} shutdown box, checked every metaint
    block (a fraction of a second) so a shutdown is noticed without waiting for
    the next TRACK CHANGE. The consumer only regains control on a yield and this
    generator yields once per track, so without it SIGTERM sat unhandled for
    however long the current song had left — long enough that launchd's
    ExitTimeOut expired and SIGKILLed the process before it could finish its
    shutdown path. Measured here before this fix: service.out.log held 20
    "signal 15 received" lines and exactly 1 "stopped.".
    Ported from radioscan.py, which fixed the same shape (upstream 87d7c74).
    """
    resp = open_stream(url)
    write_station_info(resp.headers)
    metaint = resp.headers.get("icy-metaint")
    if not metaint:
        resp.close()
        raise RuntimeError("no icy-metaint (stream has no inline metadata)")
    metaint = int(metaint)

    while not (stop is not None and stop["flag"]):
        audio = read_exactly(resp, metaint)      # discard the audio bytes
        if len(audio) < metaint:
            break                                 # stream ended / dropped
        length_byte = resp.read(1)
        if not length_byte:
            break
        meta_len = length_byte[0] * 16
        if meta_len == 0:
            continue                              # no change since last block
        meta = read_exactly(resp, meta_len).rstrip(b"\x00")
        if not meta:
            continue
        text = decode_bytes(meta)
        m = re.search(r"StreamTitle='(.*?)';", text, re.DOTALL)
        if not (m and m.group(1).strip()):
            continue
        u = re.search(r"StreamUrl='(.*?)';", text, re.DOTALL)
        yield {
            "title": m.group(1).strip(),
            "url": (u.group(1).strip() if u else ""),
            "meta_raw": text.strip(),
        }


def fetch_status_title(url):
    """
    Fallback: pull the current title from Icecast /status-json.xsl for our mount.
    Returns a title string or None.
    """
    from urllib.parse import urlsplit
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    mount = parts.path
    try:
        req = urllib.request.Request(base + "/status-json.xsl",
                                     headers={"User-Agent": USER_AGENT})
        data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "replace"))
    except Exception:
        return None
    sources = data.get("icestats", {}).get("source", [])
    if isinstance(sources, dict):
        sources = [sources]
    for s in sources:
        listurl = str(s.get("listenurl", ""))
        if listurl.endswith(mount) or not mount or mount == "/":
            return (s.get("title") or s.get("yp_currently_playing")
                    or s.get("song") or None)
    # mount didn't match but there's exactly one source - use it
    if len(sources) == 1:
        s = sources[0]
        return s.get("title") or s.get("yp_currently_playing") or s.get("song") or None
    return None


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def last_logged_title():
    """Return the most recent raw title already in the log, or None."""
    if not os.path.exists(LOG_JSONL):
        return None
    last = None
    try:
        with open(LOG_JSONL, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    last = line
        if last:
            return json.loads(last).get("raw")
    except Exception:
        return None
    return None


def append_record(raw, url="", prev_epoch=None, meta_raw=""):
    utc_iso, local_iso, epoch = now_pair()
    artist, title = parse_stream_title(raw)
    airtime = round(epoch - prev_epoch, 1) if prev_epoch else None
    rec = {
        "utc": utc_iso,
        "local": local_iso,
        "epoch": round(epoch, 3),
        "raw": raw,
        "artist": artist,
        "title": title,
        "stream_url": url,              # per-track link if the station sends one
        "prev_airtime_sec": airtime,    # how long the PREVIOUS track was on air
        "meta_raw": meta_raw,           # full raw metadata block (to inspect for extra fields)
    }
    with open(LOG_JSONL, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    new_csv = not os.path.exists(LOG_CSV) or os.path.getsize(LOG_CSV) == 0
    with open(LOG_CSV, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new_csv:
            w.writerow(["utc", "local", "artist", "title", "raw"])
        w.writerow([utc_iso, local_iso, artist, title, raw])

    with open(LATEST_TXT, "w", encoding="utf-8") as f:
        f.write(f"{local_iso}\n{raw}\n")
    return rec


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------

def load_records():
    recs = []
    if not os.path.exists(LOG_JSONL):
        return recs
    with open(LOG_JSONL, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return recs


def _iso_week_key(local_iso):
    d = datetime.fromisoformat(local_iso)
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _day_key(local_iso):
    return local_iso[:10]


def _fmt_counter(counter, n=15):
    lines = []
    for name, cnt in counter.most_common(n):
        label = name if name else "(unknown)"
        lines.append(f"| {cnt:>4} | {label} |")
    return "\n".join(lines) if lines else "| — | (none) |"


def write_day_summary(day, recs):
    plays = len(recs)
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    hours = Counter(datetime.fromisoformat(r["local"]).hour for r in recs)
    first = recs[0]["local"][11:16] if recs else "—"
    last = recs[-1]["local"][11:16] if recs else "—"
    repeats = [(t, c) for t, c in tracks.most_common() if c > 1]

    hour_line = " ".join(f"{h:02d}:{hours.get(h,0)}" for h in range(24) if hours.get(h, 0))

    out = []
    out.append(f"# Acid Jazz - {day}\n")
    out.append(f"- Tracks logged: **{plays}**")
    out.append(f"- Unique tracks: **{len(tracks)}**")
    out.append(f"- Unique artists: **{len(artists)}**")
    out.append(f"- First / last logged: {first} - {last}")
    out.append(f"- Repeated today: **{len(repeats)}** track(s)\n")
    out.append("## Top tracks\n")
    out.append("| Plays | Track |\n|---:|---|")
    out.append(_fmt_counter(tracks))
    out.append("\n## Top artists\n")
    out.append("| Plays | Artist |\n|---:|---|")
    out.append(_fmt_counter(artists))
    if repeats:
        out.append("\n## Repeated today\n")
        out.append("| Plays | Track |\n|---:|---|")
        out.append("\n".join(f"| {c:>4} | {t} |" for t, c in repeats))
    out.append(f"\n## Activity by hour\n\n{hour_line or '(none)'}\n")
    with open(os.path.join(SUMMARY_DIR, f"{day}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def write_week_summary(week, recs):
    plays = len(recs)
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    per_day = Counter(_day_key(r["local"]) for r in recs)

    out = []
    out.append(f"# Acid Jazz - week {week}\n")
    out.append(f"- Tracks logged: **{plays}**")
    out.append(f"- Unique tracks: **{len(tracks)}**")
    out.append(f"- Unique artists: **{len(artists)}**\n")
    out.append("## Plays per day\n")
    out.append("| Day | Plays |\n|---|---:|")
    out.append("\n".join(f"| {d} | {per_day[d]} |" for d in sorted(per_day)))
    out.append("\n## Top tracks this week\n")
    out.append("| Plays | Track |\n|---:|---|")
    out.append(_fmt_counter(tracks, 25))
    out.append("\n## Top artists this week\n")
    out.append("| Plays | Artist |\n|---:|---|")
    out.append(_fmt_counter(artists, 25))
    with open(os.path.join(SUMMARY_DIR, f"week-{week}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def write_overall(recs):
    plays = len(recs)
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    span = ""
    if recs:
        span = f"{recs[0]['local'][:16]}  ->  {recs[-1]['local'][:16]}"
    out = []
    out.append("# Acid Jazz - all-time overview\n")
    out.append(f"- Logging span: {span}")
    out.append(f"- Total tracks logged: **{plays}**")
    out.append(f"- Unique tracks: **{len(tracks)}**")
    out.append(f"- Unique artists: **{len(artists)}**\n")
    out.append("## Most played tracks\n")
    out.append("| Plays | Track |\n|---:|---|")
    out.append(_fmt_counter(tracks, 40))
    out.append("\n## Most played artists\n")
    out.append("| Plays | Artist |\n|---:|---|")
    out.append(_fmt_counter(artists, 40))
    with open(os.path.join(SUMMARY_DIR, "overall.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def rebuild_summaries(recs=None, only_recent=True):
    """Regenerate summary files. If only_recent, refresh just the current day+week (cheap)."""
    recs = load_records() if recs is None else recs
    if not recs:
        return
    by_day = defaultdict(list)
    by_week = defaultdict(list)
    for r in recs:
        by_day[_day_key(r["local"])].append(r)
        by_week[_iso_week_key(r["local"])].append(r)

    write_overall(recs)

    if only_recent:
        today = _day_key(recs[-1]["local"])
        thisweek = _iso_week_key(recs[-1]["local"])
        write_day_summary(today, by_day[today])
        write_week_summary(thisweek, by_week[thisweek])
    else:
        for day, drecs in by_day.items():
            write_day_summary(day, drecs)
        for week, wrecs in by_week.items():
            write_week_summary(week, wrecs)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def log_line(msg):
    utc, local, _ = now_pair()
    print(f"[{local}] {msg}", flush=True)


def cmd_test():
    print(f"Stream : {STREAM_URL}")
    print("Trying inline ICY metadata (what a media player reads)...")
    try:
        gen = icy_title_generator(STREAM_URL)
        item = next(gen)
        print(f"\n  NOW PLAYING: {item['title']}")
        artist, track = parse_stream_title(item["title"])
        print(f"  parsed artist : {artist or '(none)'}")
        print(f"  parsed title  : {track}")
        if item.get("url"):
            print(f"  stream url    : {item['url']}")
        print(f"\n  raw metadata block: {item.get('meta_raw','')}")
        print(f"  (station details written to {STATION_INFO})")
        print("\nOK - ICY metadata works. The service will log this stream fine.")
        gen.close()
        return 0
    except StopIteration:
        print("  Connected, but no title arrived quickly. Trying status page...")
    except Exception as e:
        print(f"  ICY method failed: {e}\n  Trying status page...")

    title = fetch_status_title(STREAM_URL)
    if title:
        print(f"\n  NOW PLAYING (via status page): {title}")
        print("\nOK - status-page method works. The service will use this fallback.")
        return 0
    print("\nCould not read metadata by either method.")
    print("Double-check the URL is reachable from THIS machine (open it in a media player).")
    return 1


def cmd_run():
    ensure_dirs()
    log_line(f"acidjazz radio tuner starting. Stream={STREAM_URL}")
    log_line(f"Logging to {HOME_DIR}")
    last = last_logged_title()
    last_epoch = None
    backoff = RECONNECT_MIN

    stop = {"flag": False}
    def _handle(signum, frame):
        stop["flag"] = True
        log_line(f"signal {signum} received, shutting down cleanly.")
        # Unblock a read that is stalled on a dead socket — see _LIVE_RESP.
        # shutdown() BEFORE close(), and the order is the whole point: closing a
        # descriptor does NOT wake a thread already blocked reading it (the read
        # stays parked until its own 20s timeout), while shutdown() delivers EOF
        # to that read at once. close() alone LOOKS like it works — it exits, just
        # on the socket timeout rather than on the signal, so the time-to-exit
        # tracks 20s-minus-however-long-the-stall-had-already-run instead of being
        # constant. Measured upstream: 0.25s constant with shutdown, vs 18.1s / 6.3s
        # for close-only signalled 2s / 14s into a stall. Best-effort either way —
        # the flag above still ends the run at the next check.
        r = _LIVE_RESP.get("resp")
        if r is not None:
            try:
                r.fp.raw._sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                r.close()
            except Exception:
                pass
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    while not stop["flag"]:
        try:
            try:
                gen = icy_title_generator(STREAM_URL, stop)
                mode = "icy"
            except Exception as e:
                gen = None
                mode = "status"
                log_line(f"no inline metadata ({e}); falling back to status-page polling.")

            backoff = RECONNECT_MIN  # connected OK

            if mode == "icy":
                for item in gen:
                    if stop["flag"]:
                        break
                    raw = item["title"]
                    if raw != last:
                        rec = append_record(raw, item.get("url", ""),
                                            last_epoch, item.get("meta_raw", ""))
                        last, last_epoch = raw, rec["epoch"]
                        rebuild_summaries(only_recent=True)
                        log_line(f"logged: {rec['artist']} - {rec['title']}" if rec["artist"]
                                 else f"logged: {rec['raw']}")
                gen.close()
            else:
                while not stop["flag"]:
                    raw = fetch_status_title(STREAM_URL)
                    if raw and raw != last:
                        rec = append_record(raw, "", last_epoch, "")
                        last, last_epoch = raw, rec["epoch"]
                        rebuild_summaries(only_recent=True)
                        log_line(f"logged: {rec['raw']}")
                    time.sleep(POLL_INTERVAL)

        except Exception as e:
            if stop["flag"]:
                break
            log_line(f"stream error: {e}; reconnecting in {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX)

    log_line("stopped.")
    return 0


def cmd_stats():
    recs = load_records()
    if not recs:
        print("No log yet. Let the service run for a while first.")
        return 0
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    print(f"Log span : {recs[0]['local'][:16]}  ->  {recs[-1]['local'][:16]}")
    print(f"Total logged : {len(recs)}   unique tracks : {len(tracks)}   unique artists : {len(artists)}\n")
    print("Top 15 tracks:")
    for t, c in tracks.most_common(15):
        print(f"  {c:>4}  {t}")
    print("\nTop 15 artists:")
    for a, c in artists.most_common(15):
        print(f"  {c:>4}  {a}")
    return 0


def cmd_resummarize():
    ensure_dirs()
    recs = load_records()
    if not recs:
        print("No log to summarise yet.")
        return 0
    rebuild_summaries(recs=recs, only_recent=False)
    print(f"Rebuilt summaries in {SUMMARY_DIR}")
    return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    ensure_dirs()
    if cmd == "test":
        return cmd_test()
    if cmd == "run":
        return cmd_run()
    if cmd == "stats":
        return cmd_stats()
    if cmd == "resummarize":
        return cmd_resummarize()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
