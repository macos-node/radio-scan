#!/usr/bin/env python3
"""
radio-scan - probe and log what internet radio streams are playing.

Reads the track metadata that Icecast / Shoutcast streams broadcast (the same
"Now Playing" info a media player shows), logs each track change with a
timestamp, and rolls the results up into daily / weekly summaries. Point it at
any stream URL. No third-party packages - Python 3.8+ standard library only.

QUICK USE
    python3 radioscan.py test  http://host:8000/mount      # one-off: what's playing + what the stream sends
    python3 radioscan.py run   --url http://host:8000/mount --name mystation
    python3 radioscan.py run   --config config.json         # log every station in a config file (at once)
    python3 radioscan.py stats mystation                    # top tracks/artists so far
    python3 radioscan.py resummarize mystation              # rebuild summaries from the raw log
    python3 radioscan.py list                               # stations found in the config

DATA LAYOUT (per station, under the data dir)
    <data_dir>/<name>/<name>_log.jsonl     raw log, one line per track change (source of truth)
    <data_dir>/<name>/<name>_log.csv       same data, spreadsheet-friendly
    <data_dir>/<name>/station_info.txt     what the stream advertises about itself
    <data_dir>/<name>/summaries/           daily / weekly / overall markdown + latest.txt

CONFIG (JSON)
    {
      "data_dir": "~/radio-scan-data",
      "stations": [
        {"name": "acidjazz", "url": "http://79.111.14.76:8000/acidjazz"}
      ]
    }
"""

import os
import re
import csv
import sys
import json
import time
import signal
import socket
import argparse
import threading
import urllib.request
from urllib.parse import urlsplit
from datetime import datetime, timezone
from collections import Counter, defaultdict

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_DATA_DIR = os.path.expanduser(os.environ.get("RADIOSCAN_DATA", "~/radio-scan-data"))
USER_AGENT   = "radio-scan/1.0 (+https://github.com/)"  # polite identifier
RECONNECT_MIN = 5       # seconds; stream-drop backoff starts here
RECONNECT_MAX = 120     # seconds; and caps here
POLL_INTERVAL = 20      # seconds; only used by the status.json fallback path


# ---------------------------------------------------------------------------
# Station: knows its own paths
# ---------------------------------------------------------------------------
class Station:
    def __init__(self, name, url, data_dir=DEFAULT_DATA_DIR):
        self.name = name
        self.url = url
        self.dir = os.path.join(os.path.expanduser(data_dir), name)
        # Named for the station, not for the first station this ever logged. These
        # were the literals "acidjazz_log.*", so EVERY station wrote a file called
        # acidjazz_log.jsonl inside its own correctly-named folder — logging
        # `groovesalad` produced groovesalad/acidjazz_log.jsonl. It stayed invisible
        # because the one deployed radioscan station is itself called acidjazz, where
        # the literal is accidentally right; reproduced on demand on both macOS and
        # Windows by logging any second station. It also broke the reader: ntune's
        # logger.rs builds <data_dir>/<log>/<log>_log.jsonl, so the two agreed only
        # for acidjazz. Unchanged for name == "acidjazz", so deployed logs need no
        # migration. (The episodic parsers never shared this code — they hardcode
        # their own SOURCE, e.g. "otw" -> otw_log.jsonl — so they were never affected.)
        self.jsonl = os.path.join(self.dir, f"{name}_log.jsonl")
        self.csv = os.path.join(self.dir, f"{name}_log.csv")
        self.info = os.path.join(self.dir, "station_info.txt")
        self.sumdir = os.path.join(self.dir, "summaries")
        self.latest = os.path.join(self.sumdir, "latest.txt")

    def ensure_dirs(self):
        os.makedirs(self.dir, exist_ok=True)
        os.makedirs(self.sumdir, exist_ok=True)


def name_from_url(url):
    """Derive a station slug from a URL when the user doesn't supply one."""
    parts = urlsplit(url)
    tail = (parts.path or "").strip("/").split("/")[-1]
    tail = re.sub(r"\.(mp3|aac|ogg|m3u|xspf|pls)$", "", tail, flags=re.I)
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", tail).strip("-")
    if not slug:
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", parts.netloc)
    return slug or "station"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def now_pair():
    n = datetime.now(timezone.utc)
    local = n.astimezone()
    return n.isoformat(timespec="seconds"), local.isoformat(timespec="seconds"), n.timestamp()


def decode_bytes(b):
    """ICY metadata may be UTF-8, Windows-1251 (common on RU servers), or Latin-1."""
    for enc in ("utf-8", "cp1251", "latin-1"):
        try:
            return b.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return b.decode("utf-8", errors="replace")


def parse_stream_title(raw):
    raw = (raw or "").strip()
    if " - " in raw:
        artist, title = raw.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", raw


def read_exactly(fp, n):
    chunks, remaining = [], n
    while remaining > 0:
        chunk = fp.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def log_line(prefix, msg):
    _, local, _ = now_pair()
    print(f"[{local}] ({prefix}) {msg}", flush=True)


# ---------------------------------------------------------------------------
# Metadata acquisition
# ---------------------------------------------------------------------------
# --- live streams, so a stop doesn't have to wait out the socket -------------
# The stop flag is checked between metaint blocks, which is sub-second while data
# flows. A STALLED socket is the case that beats it: the thread is parked INSIDE
# read_exactly() and never reaches the check, so the shutdown waits out
# urlopen's 20s timeout. Reported from macOS (06ec7f9), where launchd's ~20s
# ExitTimeOut loses that race and SIGKILLs mid-shutdown; on Linux systemd's 90s
# absorbs it, which is why no amount of testing here would have found it.
#
# So the signal handler reaches in and tears the socket down. No lock: dict
# get/set/pop are atomic under the GIL, and a lock could deadlock outright — with
# ONE station the handler runs on the very thread that would be holding it.
_LIVE_STREAMS = {}


def _register_stream(resp):
    _LIVE_STREAMS[threading.get_ident()] = resp


def _unregister_stream():
    _LIVE_STREAMS.pop(threading.get_ident(), None)


def close_live_streams():
    """Break every in-flight stream read. Called from the signal handler."""
    for resp in list(_LIVE_STREAMS.values()):
        # shutdown() BEFORE close(), and the order is the whole point: closing a
        # file descriptor does NOT wake a thread already blocked reading it — the
        # read stays parked until its own timeout — while shutdown() delivers EOF
        # to that read immediately. close() alone looks like it works and doesn't.
        try:
            resp.fp.raw._sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            resp.close()
        except Exception:
            pass


def open_stream(url):
    req = urllib.request.Request(url, headers={
        "Icy-MetaData": "1",
        "User-Agent": USER_AGENT,
        "Connection": "keep-alive",
    })
    return urllib.request.urlopen(req, timeout=20)


def write_station_info(headers, path):
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
        for k, v in headers.items():
            if k.lower().startswith("icy-") and k.lower() not in seen:
                lines.append(f"{k}: {v}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except Exception:
        pass


def icy_meta_generator(url, info_path=None, stop_event=None):
    """
    Yield {"title","url","meta_raw"} each time the StreamTitle changes.
    Raises RuntimeError if the server sends no icy-metaint (no inline metadata).

    `stop_event` is checked every metaint block (a fraction of a second) so a
    shutdown does not have to wait for the next TRACK CHANGE to be noticed. The
    consumer only regains control on a yield, and this generator yields once per
    track — so without this, SIGTERM sat unhandled for however long the current
    song had left. Measured on Linux before the fix: systemd waited out its full
    90s TimeoutStopSec and then SIGKILLed, which leaves the unit `failed`.
    """
    resp = open_stream(url)
    if info_path:
        write_station_info(resp.headers, info_path)
    metaint = resp.headers.get("icy-metaint")
    if not metaint:
        resp.close()
        raise RuntimeError("no icy-metaint (stream has no inline metadata)")
    metaint = int(metaint)

    _register_stream(resp)
    try:
        while not (stop_event is not None and stop_event.is_set()):
            audio = read_exactly(resp, metaint)
            if len(audio) < metaint:
                break
            length_byte = resp.read(1)
            if not length_byte:
                break
            meta_len = length_byte[0] * 16
            if meta_len == 0:
                continue
            meta = read_exactly(resp, meta_len).rstrip(b"\x00")
            if not meta:
                continue
            text = decode_bytes(meta)
            m = re.search(r"StreamTitle='(.*?)';", text, re.DOTALL)
            if not (m and m.group(1).strip()):
                continue
            u = re.search(r"StreamUrl='(.*?)';", text, re.DOTALL)
            yield {"title": m.group(1).strip(),
                   "url": (u.group(1).strip() if u else ""),
                   "meta_raw": text.strip()}
    finally:
        _unregister_stream()


def fetch_status_title(url):
    """Fallback: Icecast /status-json.xsl current title for our mount, or None."""
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    mount = parts.path
    try:
        req = urllib.request.Request(base + "/status-json.xsl", headers={"User-Agent": USER_AGENT})
        data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "replace"))
    except Exception:
        return None
    sources = data.get("icestats", {}).get("source", [])
    if isinstance(sources, dict):
        sources = [sources]
    for s in sources:
        if str(s.get("listenurl", "")).endswith(mount) or mount in ("", "/"):
            return s.get("title") or s.get("yp_currently_playing") or s.get("song") or None
    if len(sources) == 1:
        s = sources[0]
        return s.get("title") or s.get("yp_currently_playing") or s.get("song") or None
    return None


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def last_logged_title(station):
    if not os.path.exists(station.jsonl):
        return None
    last = None
    try:
        with open(station.jsonl, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    last = line
        if last:
            return json.loads(last).get("raw")
    except Exception:
        return None
    return None


def append_record(station, raw, url="", prev_epoch=None, meta_raw=""):
    utc_iso, local_iso, epoch = now_pair()
    artist, title = parse_stream_title(raw)
    airtime = round(epoch - prev_epoch, 1) if prev_epoch else None
    rec = {
        "utc": utc_iso, "local": local_iso, "epoch": round(epoch, 3),
        "raw": raw, "artist": artist, "title": title,
        "stream_url": url, "prev_airtime_sec": airtime, "meta_raw": meta_raw,
    }
    with open(station.jsonl, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    new_csv = not os.path.exists(station.csv) or os.path.getsize(station.csv) == 0
    with open(station.csv, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new_csv:
            w.writerow(["utc", "local", "artist", "title", "raw"])
        w.writerow([utc_iso, local_iso, artist, title, raw])
    with open(station.latest, "w", encoding="utf-8") as f:
        f.write(f"{local_iso}\n{raw}\n")
    return rec


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------
def load_records(station):
    recs = []
    if not os.path.exists(station.jsonl):
        return recs
    with open(station.jsonl, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return recs


def _week_key(local_iso):
    d = datetime.fromisoformat(local_iso)
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _day_key(local_iso):
    return local_iso[:10]


def _fmt_counter(counter, n=15):
    rows = [f"| {c:>4} | {(name or '(unknown)')} |" for name, c in counter.most_common(n)]
    return "\n".join(rows) if rows else "| — | (none) |"


def write_day_summary(station, day, recs):
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    hours = Counter(datetime.fromisoformat(r["local"]).hour for r in recs)
    repeats = [(t, c) for t, c in tracks.most_common() if c > 1]
    first = recs[0]["local"][11:16] if recs else "—"
    last = recs[-1]["local"][11:16] if recs else "—"
    hour_line = " ".join(f"{h:02d}:{hours[h]}" for h in range(24) if hours.get(h))
    out = [f"# {station.name} - {day}\n",
           f"- Tracks logged: **{len(recs)}**",
           f"- Unique tracks: **{len(tracks)}**",
           f"- Unique artists: **{len(artists)}**",
           f"- First / last logged: {first} - {last}",
           f"- Repeated today: **{len(repeats)}** track(s)\n",
           "## Top tracks\n", "| Plays | Track |\n|---:|---|", _fmt_counter(tracks),
           "\n## Top artists\n", "| Plays | Artist |\n|---:|---|", _fmt_counter(artists)]
    if repeats:
        out += ["\n## Repeated today\n", "| Plays | Track |\n|---:|---|",
                "\n".join(f"| {c:>4} | {t} |" for t, c in repeats)]
    out += [f"\n## Activity by hour\n\n{hour_line or '(none)'}\n"]
    with open(os.path.join(station.sumdir, f"{day}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def write_week_summary(station, week, recs):
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    per_day = Counter(_day_key(r["local"]) for r in recs)
    out = [f"# {station.name} - week {week}\n",
           f"- Tracks logged: **{len(recs)}**",
           f"- Unique tracks: **{len(tracks)}**",
           f"- Unique artists: **{len(artists)}**\n",
           "## Plays per day\n", "| Day | Plays |\n|---|---:|",
           "\n".join(f"| {d} | {per_day[d]} |" for d in sorted(per_day)),
           "\n## Top tracks this week\n", "| Plays | Track |\n|---:|---|", _fmt_counter(tracks, 25),
           "\n## Top artists this week\n", "| Plays | Artist |\n|---:|---|", _fmt_counter(artists, 25)]
    with open(os.path.join(station.sumdir, f"week-{week}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def write_overall(station, recs):
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    span = f"{recs[0]['local'][:16]}  ->  {recs[-1]['local'][:16]}" if recs else ""
    out = [f"# {station.name} - all-time overview\n",
           f"- Stream: {station.url}",
           f"- Logging span: {span}",
           f"- Total tracks logged: **{len(recs)}**",
           f"- Unique tracks: **{len(tracks)}**",
           f"- Unique artists: **{len(artists)}**\n",
           "## Most played tracks\n", "| Plays | Track |\n|---:|---|", _fmt_counter(tracks, 40),
           "\n## Most played artists\n", "| Plays | Artist |\n|---:|---|", _fmt_counter(artists, 40)]
    with open(os.path.join(station.sumdir, "overall.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def rebuild_summaries(station, recs=None, only_recent=True):
    recs = load_records(station) if recs is None else recs
    if not recs:
        return
    by_day, by_week = defaultdict(list), defaultdict(list)
    for r in recs:
        by_day[_day_key(r["local"])].append(r)
        by_week[_week_key(r["local"])].append(r)
    write_overall(station, recs)
    if only_recent:
        d, w = _day_key(recs[-1]["local"]), _week_key(recs[-1]["local"])
        write_day_summary(station, d, by_day[d])
        write_week_summary(station, w, by_week[w])
    else:
        for d, dr in by_day.items():
            write_day_summary(station, d, dr)
        for w, wr in by_week.items():
            write_week_summary(station, w, wr)


# ---------------------------------------------------------------------------
# Running a station (one loop; many run concurrently in threads)
# ---------------------------------------------------------------------------
def run_station(station, stop_event):
    station.ensure_dirs()
    log_line(station.name, f"starting. stream={station.url}  -> {station.dir}")
    last = last_logged_title(station)
    last_epoch = None
    backoff = RECONNECT_MIN

    while not stop_event.is_set():
        try:
            try:
                gen = icy_meta_generator(station.url, info_path=station.info,
                                         stop_event=stop_event)
                mode = "icy"
            except Exception as e:
                gen, mode = None, "status"
                log_line(station.name, f"no inline metadata ({e}); using status-page polling.")
            backoff = RECONNECT_MIN

            if mode == "icy":
                for item in gen:
                    if stop_event.is_set():
                        break
                    raw = item["title"]
                    if raw != last:
                        rec = append_record(station, raw, item.get("url", ""),
                                            last_epoch, item.get("meta_raw", ""))
                        last, last_epoch = raw, rec["epoch"]
                        rebuild_summaries(station, only_recent=True)
                        log_line(station.name, f"logged: {rec['raw']}")
                gen.close()
            else:
                while not stop_event.is_set():
                    raw = fetch_status_title(station.url)
                    if raw and raw != last:
                        rec = append_record(station, raw, "", last_epoch, "")
                        last, last_epoch = raw, rec["epoch"]
                        rebuild_summaries(station, only_recent=True)
                        log_line(station.name, f"logged: {rec['raw']}")
                    stop_event.wait(POLL_INTERVAL)
        except Exception as e:
            if stop_event.is_set():
                break
            log_line(station.name, f"stream error: {e}; reconnecting in {backoff}s")
            stop_event.wait(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX)
    log_line(station.name, "stopped.")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def load_config(path):
    with open(os.path.expanduser(path), "r", encoding="utf-8") as f:
        cfg = json.load(f)
    data_dir = cfg.get("data_dir", DEFAULT_DATA_DIR)
    stations = []
    for s in cfg.get("stations", []):
        url = s["url"]
        stations.append(Station(s.get("name") or name_from_url(url), url, data_dir))
    return stations


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def cmd_test(url):
    print(f"Stream : {url}")
    print("Trying inline ICY metadata (what a media player reads)...")
    try:
        gen = icy_meta_generator(url)
        item = next(gen)
        artist, track = parse_stream_title(item["title"])
        print(f"\n  NOW PLAYING : {item['title']}")
        print(f"  artist      : {artist or '(none)'}")
        print(f"  title       : {track}")
        if item.get("url"):
            print(f"  stream url  : {item['url']}")
        print(f"  raw block   : {item.get('meta_raw','')}")
        print("\nOK - this stream sends inline metadata; radio-scan can log it.")
        gen.close()
        return 0
    except StopIteration:
        print("  Connected but no title arrived quickly; trying the status page...")
    except Exception as e:
        print(f"  ICY method failed: {e}\n  Trying the status page...")
    title = fetch_status_title(url)
    if title:
        print(f"\n  NOW PLAYING (status page): {title}")
        print("\nOK - status-page fallback works; radio-scan can log it.")
        return 0
    print("\nCould not read metadata by either method.")
    print("Check the URL opens in a media player from this machine.")
    return 1


def _stations_from_args(args):
    if args.config:
        return load_config(args.config)
    if args.url:
        name = args.name or name_from_url(args.url)
        return [Station(name, args.url, args.data_dir)]
    return []


def cmd_run(args):
    stations = _stations_from_args(args)
    if not stations:
        print("Nothing to run. Pass --url URL [--name NAME] or --config config.json")
        return 2

    stop_event = threading.Event()

    def _handle(signum, frame):
        log_line("main", f"signal {signum} received; shutting down.")
        stop_event.set()
        # Setting the flag is not enough on its own: a reader blocked on a stalled
        # socket will not look at it until the socket times out.
        close_live_streams()
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    if len(stations) == 1:
        run_station(stations[0], stop_event)
        return 0

    log_line("main", f"monitoring {len(stations)} stations: " + ", ".join(s.name for s in stations))
    threads = []
    for s in stations:
        t = threading.Thread(target=run_station, args=(s, stop_event), name=s.name, daemon=True)
        t.start()
        threads.append(t)
    try:
        while any(t.is_alive() for t in threads) and not stop_event.is_set():
            stop_event.wait(1)
    finally:
        stop_event.set()
        for t in threads:
            t.join(timeout=5)
    return 0


def cmd_stats(args):
    station = _one_station(args)
    if not station:
        return 2
    recs = load_records(station)
    if not recs:
        print(f"No log yet for '{station.name}'. Let it run first.")
        return 0
    tracks = Counter(r["raw"] for r in recs)
    artists = Counter(r["artist"] for r in recs if r["artist"])
    print(f"[{station.name}] {recs[0]['local'][:16]} -> {recs[-1]['local'][:16]}")
    print(f"logged={len(recs)}  unique tracks={len(tracks)}  unique artists={len(artists)}\n")
    print("Top 15 tracks:")
    for t, c in tracks.most_common(15):
        print(f"  {c:>4}  {t}")
    print("\nTop 15 artists:")
    for a, c in artists.most_common(15):
        print(f"  {c:>4}  {a}")
    return 0


def cmd_resummarize(args):
    station = _one_station(args)
    if not station:
        return 2
    station.ensure_dirs()
    recs = load_records(station)
    if not recs:
        print(f"No log to summarise for '{station.name}'.")
        return 0
    rebuild_summaries(station, recs=recs, only_recent=False)
    print(f"Rebuilt summaries in {station.sumdir}")
    return 0


def cmd_list(args):
    if not args.config:
        print("Pass --config config.json to list its stations.")
        return 2
    for s in load_config(args.config):
        print(f"  {s.name:<20} {s.url}")
    return 0


def _one_station(args):
    """Resolve a single station for stats/resummarize by name (from config) or --url."""
    if args.config and args.name:
        for s in load_config(args.config):
            if s.name == args.name:
                return s
        print(f"Station '{args.name}' not found in {args.config}")
        return None
    if args.name:
        return Station(args.name, args.url or "", args.data_dir)
    if args.url:
        return Station(name_from_url(args.url), args.url, args.data_dir)
    print("Specify a station: NAME (with --config) or --name / --url")
    return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_parser():
    p = argparse.ArgumentParser(prog="radioscan", description="Probe and log internet radio streams.")
    sub = p.add_subparsers(dest="cmd")

    t = sub.add_parser("test", help="probe a stream once and show what it sends")
    t.add_argument("url")

    r = sub.add_parser("run", help="log one station (--url) or all in a --config")
    r.add_argument("--url")
    r.add_argument("--name")
    r.add_argument("--config")
    r.add_argument("--data-dir", default=DEFAULT_DATA_DIR)

    for cname in ("stats", "resummarize"):
        c = sub.add_parser(cname, help=f"{cname} for a station")
        c.add_argument("name", nargs="?")
        c.add_argument("--url")
        c.add_argument("--config")
        c.add_argument("--data-dir", default=DEFAULT_DATA_DIR)

    ls = sub.add_parser("list", help="list stations in a config")
    ls.add_argument("--config")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.cmd == "test":
        return cmd_test(args.url)
    if args.cmd == "run":
        return cmd_run(args)
    if args.cmd == "stats":
        return cmd_stats(args)
    if args.cmd == "resummarize":
        return cmd_resummarize(args)
    if args.cmd == "list":
        return cmd_list(args)
    build_parser().print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
