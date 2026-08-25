#!/usr/bin/env python3
"""
On The Wire (Steve Barker) playlist parser.

Unlike the acid-jazz Icecast logger — which scrapes live ICY now-playing
metadata off a continuous stream — On The Wire is a weekly archived show whose
FULL tracklist is already published, per episode, on the Blogger feed. So there
is nothing to catch live: we just pull the feed and parse each week's post.

Feed format (per track line, separated by <br/> in the post HTML):
    Artist - Title - Label (Album)
Gotchas handled:
  * separator is a SPACED dash: hyphen '-', en-dash '–', or em-dash '—'
  * parentheses are NOT reliable field markers — they show up inside titles
    (remix tags) and inside artist names (alias credits), so we split on the
    spaced dash, never on '('.
  * album (trailing parens) is only lifted off the LAST field, and only when
    there are >=3 fields — a 2-field "Artist - Title (rmx)" keeps its parens.

Usage:
    python3 otw_playlist.py              # latest episode -> print + write CSV/JSONL
    python3 otw_playlist.py --all        # every episode in the feed (paginated)
    python3 otw_playlist.py --no-write   # just print, don't touch the log files
    python3 otw_playlist.py --clean      # filter raw log -> *.clean.{jsonl,csv}
    python3 otw_playlist.py --data-dir ~/RadioTuner   # append to a pre-vendoring log

DATA LAYOUT (mirrors radioscan.py)
    <data_dir>/otw/otw_log.jsonl         raw log, one line per track (source of truth)
    <data_dir>/otw/otw_log.csv           same data, spreadsheet-friendly
    <data_dir>/otw/otw_log.clean.*       --clean output, prose/embeds filtered out
    data_dir defaults to $RADIOSCAN_DATA or ~/radio-scan-data.

SCHEDULING
    Weekly. On Linux see service/install-linux-episodic.sh (systemd user timer,
    Mon 09:00); the macOS original ran under launchd com.tigger.otwradio.
"""
from __future__ import annotations
import argparse, csv, html, json, re, sys, urllib.request
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import unquote
import os
from pathlib import Path
from xml.etree import ElementTree as ET

FEED = "https://otwradio.blogspot.com/feeds/posts/default?alt=rss"
SOURCE = "otw"

# Where the logs live. Mirrors radioscan.py: same env var, same default, one
# directory per source — so the live-stream logger and the episodic parsers land
# in one tree instead of three. The originals wrote beside the script; pass
# `--data-dir ~/RadioTuner` to keep appending to a pre-vendoring log.
DEFAULT_DATA_DIR = os.environ.get("RADIOSCAN_DATA", "~/radio-scan-data")
CSV_OUT = JSONL_OUT = CSV_CLEAN = JSONL_CLEAN = None  # set by set_data_dir()


def set_data_dir(base: str) -> None:
    """Point the module's four output paths at <base>/otw/, creating it."""
    global CSV_OUT, JSONL_OUT, CSV_CLEAN, JSONL_CLEAN
    d = Path(base).expanduser() / SOURCE
    d.mkdir(parents=True, exist_ok=True)
    CSV_OUT     = d / "otw_log.csv"
    JSONL_OUT   = d / "otw_log.jsonl"
    CSV_CLEAN   = d / "otw_log.clean.csv"
    JSONL_CLEAN = d / "otw_log.clean.jsonl"

# --- clean-pass filters (structural, not content) --------------------------
# The feed's post bodies carry a few non-track lines that survive parsing:
# self-referential Mixcloud embeds ("On the Wire - <date> by Otwradio on
# Mixcloud"), BBC iPlayer link lines ("Audio - (IPlayer)"), and multi-line
# prose from tribute/announcement posts. A real track is a single
# <br/>-delimited line, so an embedded newline is a reliable prose tell.
DENY_ARTIST = {"On the Wire", "On The Wire", "Audio"}
LINK_LINE = re.compile(
    r"(?i)(by otwradio|on\s+mixcloud|mixcloud\.com|soundcloud|\biplayer\b|"
    r"radio buena vida|listen again)")
PAREN_ONLY = re.compile(r"^\(.*\)$")


def junk_reason(r: dict) -> str | None:
    """Why this row is not a real track, or None if it looks legit."""
    if "\n" in r["raw"]:                     return "prose (embedded newline)"
    if not r["artist"] or not r["title"]:    return "empty artist/title"
    if r["artist"] in DENY_ARTIST:           return "self-ref/link artist"
    if LINK_LINE.search(r["raw"]):           return "embed/link line"
    if PAREN_ONLY.match(r["title"].strip()): return "paren-only title"
    return None

# spaced dash: whitespace, one of - – —, whitespace
SEP   = re.compile(r"\s+[-–—]\s+")
ALBUM = re.compile(r"\s*\(([^)]*)\)\s*$")        # trailing (Album) on the last field
LEADNUM = re.compile(r"^\s*\d{1,3}[.)]\s+")       # strip "12. " track numbering
TAGS  = re.compile(r"<[^>]+>")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "otw-playlist/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


# The show is a BLOG, not a podcast: the Blogger feed carries tracklists and no
# audio at all — 0 <enclosure>, 0 <media:content>, no .mp3/.m4a anywhere in it
# (checked against the live feed 2026-08-25). The audio lives on Mixcloud, embedded
# as a player iframe, and Mixcloud publishes no stream URL by design — their API
# returns name/page/audio_length and nothing to hand an <audio> element. So the most
# an honest logger can carry is WHERE TO LISTEN, and that is what this captures.
MIXCLOUD_EMBED = re.compile(r"player-widget\.mixcloud\.com/widget/iframe/\?[^\"'<>]*?feed=([^\"'&<>]+)", re.I)
MIXCLOUD_LINK = re.compile(r"https?://(?:www\.)?mixcloud\.com/([^\"'<>\s]+)", re.I)


def _mixcloud_page(path: str) -> str:
    """`otwradio/on-the-wire-…` -> the canonical page URL, or '' if unusable.

    Two things are rejected rather than stored, and both were found in the archive
    rather than imagined:

    Tracking parameters are cut, not carried. Older posts link with a
    `?utm_source=widget&…` tail, and appending the trailing slash after THAT
    produced `…/?utm_term=resource_link/` — a URL that happens to still resolve
    and is plainly wrong to store.

    A bare PROFILE is not an episode. `mixcloud.com/luckycatzoe/` is one path
    segment and points at a person's page; an episode is always
    `user/episode-slug`, two segments. Guest-mix posts link the guest's profile,
    and storing that as this episode's listen link sends a reader somewhere that
    does not contain the show they asked for — worse than an empty field, which at
    least says so. Reported from macOS after both boxes backfilled and got the
    same 184 links, 2 of them these.
    """
    path = unquote(path).strip().split("?", 1)[0].split("#", 1)[0].strip("/")
    if not path or path.startswith("widget") or path.count("/") < 1:
        return ""
    return f"https://www.mixcloud.com/{path}/"


def listen_url(body: str) -> str:
    """The Mixcloud page for an episode, from the post body. '' when there isn't one.

    Two shapes, because both appear in the archive: the embedded player (whose
    `feed=` parameter is the URL-encoded page path) and a plain link. Returns the
    canonical page URL either way — never a stream URL, because there isn't one.
    """
    for rx in (MIXCLOUD_EMBED, MIXCLOUD_LINK):
        m = rx.search(body)
        if m:
            url = _mixcloud_page(m.group(1))
            if url:
                return url
    return ""


def parse_track(line: str) -> dict | None:
    """One playlist line -> {artist,title,label,album,raw} or None if not a track."""
    raw = line.strip()
    if not raw:
        return None
    line = LEADNUM.sub("", raw)
    parts = [p.strip() for p in SEP.split(line) if p.strip()]
    if len(parts) < 2:            # a header / segment marker / prose line — skip
        return None
    artist, title = parts[0], parts[1]
    label = " - ".join(parts[2:]) if len(parts) > 2 else ""
    album = ""
    if label:                     # album parens only ride on the label field
        m = ALBUM.search(label)
        if m:
            album = m.group(1).strip()
            label = ALBUM.sub("", label).strip()
    return {"artist": artist, "title": title, "label": label,
            "album": album, "raw": raw}


def parse_episode(item: ET.Element) -> dict:
    title = (item.findtext("title") or "").strip()
    pub   = item.findtext("pubDate") or ""
    try:
        dt = parsedate_to_datetime(pub).astimezone(timezone.utc)
        ep_date = dt.date().isoformat()
        ep_utc  = dt.isoformat()
    except Exception:
        ep_date, ep_utc = "", ""
    body = html.unescape(item.findtext("description") or "")
    # each track sits on its own <br/>-delimited line; kill remaining tags
    lines = re.split(r"<br\s*/?>", body, flags=re.I)
    tracks = []
    for ln in lines:
        ln = html.unescape(TAGS.sub("", ln)).strip()
        t = parse_track(ln)
        if t:
            t["pos"] = len(tracks) + 1
            tracks.append(t)
    return {"episode": title, "episode_date": ep_date,
            "episode_utc": ep_utc, "listen_url": listen_url(body),
            "tracks": tracks}


def episodes_from_feed(url: str, want_all: bool) -> list[dict]:
    out, start = [], 1
    while True:
        page = url + (f"&max-results=25&start-index={start}" if want_all
                      else "&max-results=1")
        items = ET.fromstring(fetch(page)).findall(".//item")
        if not items:
            break
        out += [parse_episode(it) for it in items]
        if not want_all or len(items) < 25:
            break
        start += 25
    return out


# `listen_url` joined the schema on 2026-08-25. Appending a wider row to a CSV
# still carrying the old header would silently misalign every later column, so the
# file is upgraded in place the first time it matters.
COLUMNS = ["episode", "episode_date", "pos", "artist", "title", "label", "album",
           "raw", "listen_url"]


def _upgrade_csv_schema(path, cols) -> None:
    if not path.exists():
        return
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    if rows and set(rows[0]) == set(cols):
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
    tmp.replace(path)
    print(f"upgraded {path.name} to the {len(cols)}-column schema", file=sys.stderr)


def write_logs(eps: list[dict]) -> None:
    seen = set()
    if JSONL_OUT.exists():
        with JSONL_OUT.open() as f:
            for ln in f:
                try:
                    seen.add(json.loads(ln)["episode"])
                except Exception:
                    pass
    new_rows = []
    for ep in eps:
        if ep["episode"] in seen:
            continue
        for t in ep["tracks"]:
            new_rows.append({"episode": ep["episode"],
                             "episode_date": ep["episode_date"],
                             "pos": t["pos"], "artist": t["artist"],
                             "title": t["title"], "label": t["label"],
                             "album": t["album"], "raw": t["raw"],
                             "listen_url": ep.get("listen_url", "")})
    if not new_rows:
        print("(nothing new to log)", file=sys.stderr)
        return
    cols = COLUMNS
    _upgrade_csv_schema(CSV_OUT, cols)
    write_header = not CSV_OUT.exists()
    with CSV_OUT.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        if write_header:
            w.writeheader()
        w.writerows(new_rows)
    with JSONL_OUT.open("a") as f:
        for r in new_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"logged {len(new_rows)} tracks from "
          f"{len({r['episode'] for r in new_rows})} new episode(s)", file=sys.stderr)


def relink() -> None:
    """Fill `listen_url` on episodes already in the raw log. Adds nothing else.

    Needed because the log predates the field and `write_logs` skips episodes it
    has already seen — without this, only FUTURE episodes would ever carry a link,
    and the recent ones somebody actually wants to listen to would not.
    """
    if not JSONL_OUT.exists():
        sys.exit(f"no raw log at {JSONL_OUT} — run a capture first")
    links = {ep["episode"]: ep.get("listen_url", "")
             for ep in episodes_from_feed(FEED, True)}
    rows = [json.loads(ln) for ln in JSONL_OUT.open() if ln.strip()]
    filled = repaired = 0
    for r in rows:
        have, want = r.get("listen_url") or "", links.get(r.get("episode")) or ""
        if not have and want:
            r["listen_url"] = want
            filled += 1
        elif have:
            # Re-derive what the CURRENT rule makes of the stored path and store
            # that. A link the rule already agrees with normalizes to itself, so a
            # valid one — including a hand-corrected one — is untouched and a
            # re-run is a no-op. A link the rule now rejects (a query-string tail,
            # a bare profile) is replaced, and being replaced by NOTHING is a
            # legitimate outcome: no link beats a link to the wrong page.
            fixed = _mixcloud_page(have.split("mixcloud.com/", 1)[-1])
            if fixed != have:
                r["listen_url"] = fixed
                repaired += 1
    tmp = JSONL_OUT.with_suffix(".jsonl.tmp")
    with tmp.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(JSONL_OUT)
    _upgrade_csv_schema(CSV_OUT, COLUMNS)
    with CSV_OUT.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows({c: r.get(c, "") for c in COLUMNS} for r in rows)
    episodes = len({r["episode"] for r in rows if r.get("listen_url")})
    print(f"relink: filled {filled} rows, repaired {repaired}; {episodes} episode(s) "
          f"now carry a link out of {len({r['episode'] for r in rows})}", file=sys.stderr)
    print("run --clean to carry it into the clean log", file=sys.stderr)


def clean_log() -> None:
    """Filter otw_log.jsonl -> otw_log.clean.{jsonl,csv}. Non-destructive."""
    if not JSONL_OUT.exists():
        sys.exit(f"no raw log at {JSONL_OUT} — run a capture first")
    rows = [json.loads(ln) for ln in JSONL_OUT.open() if ln.strip()]
    kept, dropped = [], Counter()
    for r in rows:
        reason = junk_reason(r)
        if reason:
            dropped[reason] += 1
        else:
            kept.append(r)
    cols = COLUMNS
    with JSONL_CLEAN.open("w") as f:
        for r in kept:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with CSV_CLEAN.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(kept)
    print(f"clean: kept {len(kept)}/{len(rows)} rows "
          f"({len(rows) - len(kept)} dropped)", file=sys.stderr)
    for reason, n in dropped.most_common():
        print(f"  drop [{reason}]: {n}", file=sys.stderr)
    print(f"wrote {JSONL_CLEAN.name} + {CSV_CLEAN.name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse On The Wire playlists from the Blogger feed.")
    ap.add_argument("--all", action="store_true", help="every episode in the feed, not just latest")
    ap.add_argument("--no-write", action="store_true", help="print only; don't append to logs")
    ap.add_argument("--relink", action="store_true",
                    help="fill listen_url on episodes already logged, then exit")
    ap.add_argument("--clean", action="store_true",
                    help="filter the raw log into otw_log.clean.{jsonl,csv} and exit (no fetch)")
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR,
                    help=f"where logs live (default: {DEFAULT_DATA_DIR}, or $RADIOSCAN_DATA)")
    args = ap.parse_args()
    set_data_dir(args.data_dir)

    if args.clean:
        clean_log()
        return

    if args.relink:
        relink()
        return

    eps = episodes_from_feed(FEED, args.all)
    for ep in eps:
        print(f"\n=== {ep['episode']}  ({ep['episode_date']})  "
              f"{len(ep['tracks'])} tracks ===")
        for t in ep["tracks"]:
            extra = f"   [{t['label']}{' / ' + t['album'] if t['album'] else ''}]" if t["label"] else ""
            print(f"  {t['pos']:2d}. {t['artist']}  —  {t['title']}{extra}")
    if not args.no_write:
        write_logs(eps)


if __name__ == "__main__":
    main()
