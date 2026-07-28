#!/usr/bin/env python3
"""
enrich.py - add album / year / MusicBrainz links to a radio-scan log.

Takes the unique artist+title pairs from a log and looks each up on the
MusicBrainz API (no API key needed), writing an enriched CSV. Standard library
only. Needs internet where you run it.

Usage:
    python3 enrich.py path/to/acidjazz_log.jsonl
    python3 enrich.py path/to/acidjazz_log.jsonl --out enriched.csv --limit 200

MusicBrainz asks clients to send a descriptive User-Agent and to make no more
than ~1 request/second - both are handled below. Please set a real contact in
CONTACT if you run this a lot.
"""

import os
import sys
import csv
import json
import time
import argparse
import urllib.parse
import urllib.request
from collections import Counter

CONTACT = "radio-scan (set-your-email@example.com)"
MB_URL = "https://musicbrainz.org/ws/2/recording"
RATE_SECONDS = 1.1


def load_pairs(path):
    counts = Counter()
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            artist = (r.get("artist") or "").strip()
            title = (r.get("title") or "").strip()
            if artist and title:
                counts[(artist, title)] += 1
    return counts


def mb_lookup(artist, title):
    q = f'artist:"{artist}" AND recording:"{title}"'
    url = MB_URL + "?" + urllib.parse.urlencode({"query": q, "fmt": "json", "limit": 1})
    req = urllib.request.Request(url, headers={"User-Agent": CONTACT})
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace"))
    except Exception as e:
        return {"error": str(e)}
    recs = data.get("recordings") or []
    if not recs:
        return {}
    rec = recs[0]
    out = {"mbid": rec.get("id", ""), "score": rec.get("score", "")}
    releases = rec.get("releases") or []
    if releases:
        rel = releases[0]
        out["album"] = rel.get("title", "")
        out["date"] = rel.get("date", "")
        out["year"] = (rel.get("date", "") or "")[:4]
        rg = rel.get("release-group") or {}
        out["type"] = rg.get("primary-type", "")
    out["url"] = f"https://musicbrainz.org/recording/{rec.get('id','')}" if rec.get("id") else ""
    return out


def main():
    ap = argparse.ArgumentParser(description="Enrich a radio-scan log via MusicBrainz.")
    ap.add_argument("log", help="path to a *_log.jsonl file")
    ap.add_argument("--out", help="output CSV path (default: enriched.csv next to the log)")
    ap.add_argument("--limit", type=int, default=0, help="only the N most-played tracks (0 = all)")
    args = ap.parse_args()

    counts = load_pairs(args.log)
    if not counts:
        print("No artist+title pairs found in that log.")
        return 1
    pairs = counts.most_common(args.limit or None)
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.log)), "enriched.csv")

    print(f"Enriching {len(pairs)} unique tracks (~{RATE_SECONDS}s each, be patient)...")
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["plays", "artist", "title", "album", "year", "type", "mb_score", "musicbrainz_url"])
        for i, ((artist, title), plays) in enumerate(pairs, 1):
            info = mb_lookup(artist, title)
            w.writerow([plays, artist, title, info.get("album", ""), info.get("year", ""),
                        info.get("type", ""), info.get("score", ""), info.get("url", "")])
            f.flush()
            print(f"  [{i}/{len(pairs)}] {artist} - {title}"
                  + (f"  -> {info.get('album','')} ({info.get('year','')})" if info.get("album") else ""))
            time.sleep(RATE_SECONDS)
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
