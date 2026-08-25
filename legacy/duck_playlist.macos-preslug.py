#!/usr/bin/env python3
"""
"A Duck in a Tree" (:zoviet*france:) tracklist parser — third logging source.

A weekly ~59-minute continuous mix podcast on Podbean whose show-notes carry a
FULL tracklist per episode. Like On The Wire it's episodic (no live stream), but
the whole 700+ episode archive ships in ONE RSS document, so backfill needs no
pagination — a single fetch has everything from 2012 to now.

Show-notes format (inside <content:encoded>, after a "track list" marker,
<br>-delimited):
    00 [anonymous] - Intro
    01 Rescopic Sound - SCIMisc_Robotic Glitch Medium 02_RSCPC_SFEW
    02 Juanjo Palacios - Playa
    ...
    ++ [anonymous] - Outro
Each line is `<pos> <artist> - <title>`. `pos` is a 2-digit index or a marker
(00 intro, ++ outro). The leading index makes prose trivially rejectable — a
real track line always starts with a number or ++/-- marker.

Schema mirrors otw_log so RadioBar's unified decoder reads it as an episodic
source (episode / episode_date / pos / artist / title / raw), plus podcast
extras (theme / ep_num / audio_url / duration) that the Swift decoder ignores.

Usage:
    python3 duck_playlist.py            # latest episode -> print + write CSV/JSONL
    python3 duck_playlist.py --all      # whole archive (one fetch)
    python3 duck_playlist.py --no-write # print only
    python3 duck_playlist.py --clean    # filter raw log -> *.clean.{jsonl,csv}
"""
from __future__ import annotations
import argparse, csv, html, json, re, sys, urllib.request
from collections import Counter
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

FEED = "https://feed.podbean.com/zovietfrance/feed.xml"
HERE = Path(__file__).resolve().parent
CSV_OUT   = HERE / "duck_log.csv"
JSONL_OUT = HERE / "duck_log.jsonl"
CSV_CLEAN   = HERE / "duck_log.clean.csv"
JSONL_CLEAN = HERE / "duck_log.clean.jsonl"

CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"
ITUNES_DUR = "{http://www.itunes.com/dtds/podcast-1.0.dtd}duration"

DATE_IN_TITLE = re.compile(r"(\d{4}-\d{2}-\d{2})")
EP_NUM = re.compile(r"The\s+(\d+)(?:st|nd|rd|th)\s+of a series", re.I)
TAGS = re.compile(r"<[^>]+>")
# a track line: leading index (2-3 digits) or ++/-- marker, then "artist - title"
TRACK = re.compile(r"^\s*(\d{1,3}|[+\-]{2})\s+(.+?)\s+[-–]\s+(.+?)\s*$")
COLS = ["episode", "episode_date", "theme", "ep_num", "pos", "artist", "title",
        "raw", "audio_url", "duration"]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "duck-playlist/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def cdata(s: str | None) -> str:
    return html.unescape((s or "").replace("<![CDATA[", "").replace("]]>", ""))


def parse_episode(item: ET.Element) -> dict:
    title = cdata(item.findtext("title")).strip()
    pub = item.findtext("pubDate") or ""
    dm = DATE_IN_TITLE.search(title)
    if dm:
        ep_date = dm.group(1)
    else:
        try:
            ep_date = parsedate_to_datetime(pub).astimezone(timezone.utc).date().isoformat()
        except Exception:
            ep_date = ""
    theme = title.split("|", 1)[1].strip() if "|" in title else ""

    enc = item.find("enclosure")
    audio_url = enc.get("url") if enc is not None else ""
    duration = item.findtext(ITUNES_DUR) or ""

    body = cdata(item.findtext(CONTENT_NS) or item.findtext("description"))
    ep_num = (EP_NUM.search(body).group(1) if EP_NUM.search(body) else "")

    # tracklist lives after the "track list" marker; split on <br> and <p> edges
    i = body.lower().find("track list")
    segment = body[i:] if i >= 0 else body
    lines = re.split(r"<br\s*/?>|</?p[^>]*>", segment, flags=re.I)
    tracks = []
    for ln in lines:
        ln = html.unescape(TAGS.sub("", ln)).strip()
        m = TRACK.match(ln)
        if not m:
            continue
        pos, artist, ttl = m.group(1), m.group(2).strip(), m.group(3).strip()
        tracks.append({"pos": pos, "artist": artist, "title": ttl, "raw": ln})
    return {"episode": title, "episode_date": ep_date, "theme": theme,
            "ep_num": ep_num, "audio_url": audio_url, "duration": duration,
            "tracks": tracks}


def episodes_from_feed() -> list[dict]:
    root = ET.fromstring(fetch(FEED))
    return [parse_episode(it) for it in root.findall(".//item")]


# --- clean pass: drop the [anonymous] intro/outro markers ------------------
def is_marker(r: dict) -> bool:
    return r["artist"].strip().lower() in ("[anonymous]", "anonymous") \
        or r["title"].strip().lower() in ("intro", "outro")


def rows_of(ep: dict) -> list[dict]:
    return [{"episode": ep["episode"], "episode_date": ep["episode_date"],
             "theme": ep["theme"], "ep_num": ep["ep_num"], "pos": t["pos"],
             "artist": t["artist"], "title": t["title"], "raw": t["raw"],
             "audio_url": ep["audio_url"], "duration": ep["duration"]}
            for t in ep["tracks"]]


def write_logs(eps: list[dict]) -> None:
    seen = set()
    if JSONL_OUT.exists():
        with JSONL_OUT.open() as f:
            for ln in f:
                try:
                    seen.add(json.loads(ln)["episode"])
                except Exception:
                    pass
    new_rows = [r for ep in eps if ep["episode"] not in seen for r in rows_of(ep)]
    if not new_rows:
        print("(nothing new to log)", file=sys.stderr)
        return
    write_header = not CSV_OUT.exists()
    with CSV_OUT.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        if write_header:
            w.writeheader()
        w.writerows(new_rows)
    with JSONL_OUT.open("a") as f:
        for r in new_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"logged {len(new_rows)} tracks from "
          f"{len({r['episode'] for r in new_rows})} new episode(s)", file=sys.stderr)


def clean_log() -> None:
    if not JSONL_OUT.exists():
        sys.exit(f"no raw log at {JSONL_OUT} — run a capture first")
    rows = [json.loads(ln) for ln in JSONL_OUT.open() if ln.strip()]
    kept = [r for r in rows if not is_marker(r)]
    with JSONL_CLEAN.open("w") as f:
        for r in kept:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with CSV_CLEAN.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(kept)
    print(f"clean: kept {len(kept)}/{len(rows)} rows "
          f"({len(rows) - len(kept)} intro/outro markers dropped)", file=sys.stderr)
    print(f"wrote {JSONL_CLEAN.name} + {CSV_CLEAN.name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse 'A Duck in a Tree' tracklists from the Podbean feed.")
    ap.add_argument("--all", action="store_true", help="whole archive (default: latest only)")
    ap.add_argument("--no-write", action="store_true", help="print only; don't append to logs")
    ap.add_argument("--clean", action="store_true", help="filter raw log -> *.clean.* and exit")
    args = ap.parse_args()

    if args.clean:
        clean_log()
        return

    eps = episodes_from_feed()
    if not args.all:
        eps = eps[:1]
    for ep in eps:
        real = [t for t in ep["tracks"] if not is_marker(t)]
        print(f"\n=== {ep['episode']}  ({ep['episode_date']})  "
              f"{len(real)} tracks [ep {ep['ep_num'] or '?'}] ===")
        for t in ep["tracks"]:
            print(f"  {t['pos']:>2}. {t['artist']}  —  {t['title']}")
    if not args.no_write:
        write_logs(eps)


if __name__ == "__main__":
    main()
