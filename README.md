# radio-scan

> **Part of the [n-suite](./SUITE.md).** This repo ships the standalone logger
> below. Its evolution into a Nostr-native, social airplay member of the suite is
> mapped in **[radio-scan-introduction.md](./radio-scan-introduction.md)**,
> **[docs/radio-scan-buildmap-2026-07-28.md](./docs/radio-scan-buildmap-2026-07-28.md)**,
> and the wire-contract proposal
> **[schema/airplay-design-2026-07-28.md](./schema/airplay-design-2026-07-28.md)**.

Probe and log what internet radio streams are playing. `radio-scan` reads the
"Now Playing" metadata that Icecast/Shoutcast streams broadcast, records every
track change with a timestamp, and rolls the results into daily / weekly
summaries — so you can see the *shape* of a station's playlist over time: its
rotation, most-played tracks, repeat offenders, and busiest hours.

Point it at any stream URL. It's a single Python file with **no dependencies**
(standard library only, Python 3.8+).

It started as a way to recover a playlist someone liked but never wrote down,
and generalised into a small tuner you can aim at any stream.

## How it works

Most Icecast and Shoutcast streams embed metadata *inside the audio* using the
old SHOUTcast "ICY" convention:

1. You open the stream URL with the request header `Icy-MetaData: 1`.
2. The server responds with a header `icy-metaint: N`.
3. From then on, after every `N` bytes of audio it inserts a short text block
   like `StreamTitle='Artist - Title';` (occasionally also `StreamUrl='...';`).
4. That block is only non-empty when the title **changes** — which gives you
   free de-duplication: you log a track exactly when it starts.

`radio-scan` holds a single connection open and reads those blocks in real time
(it discards the audio bytes — it never records audio). If a server sends no
inline metadata, it falls back to polling the Icecast `/status-json.xsl` status
page. Text is decoded as UTF‑8, then Windows‑1251, then Latin‑1, so non-English
and Cyrillic track names survive.

What you can expect per track is just the `StreamTitle` — "Artist - Title".
Album, year, and label are **not** in the stream; derive those afterwards (see
[Enrichment](#enrichment)).

## Requirements

Python 3.8+. Nothing else. (macOS ships it; on Linux use your package manager.)

## Quick start — probe any stream

```bash
python3 radioscan.py test http://your.stream.host:8000/mount
```

This connects once and prints the current track, the parsed artist/title, any
per-track URL, and the raw metadata block, and writes a `station_info.txt`
showing what the station advertises about itself (name, genre, bitrate). Use it
to check a URL before you commit to logging it.

## Log a station

One station, ad hoc:

```bash
python3 radioscan.py run --url http://your.stream.host:8000/mount --name mystation
```

Many stations at once, from a config file (each runs in its own thread):

```bash
python3 radioscan.py run --config config.json
```

`config.json` (see `config.example.json`):

```json
{
  "data_dir": "~/radio-scan-data",
  "stations": [
    { "name": "acidjazz", "url": "http://79.111.14.76:8000/acidjazz" },
    { "name": "somestation", "url": "http://another.host:8000/stream" }
  ]
}
```

Leave a `name` out and it's derived from the URL. It reconnects automatically
with backoff if a stream drops.

## Run it 24/7 as a service

For continuous, unattended logging, install it as a background service. It
starts on boot/login and restarts itself if it ever exits.

**macOS (launchd):**

```bash
cd service && ./install-macos.sh
# after editing ~/radio-scan/config.json:
launchctl kickstart -k gui/$(id -u)/com.radioscan
```

**Linux (systemd user service):**

```bash
cd service && ./install-linux.sh
# after editing ~/radio-scan/config.json:
systemctl --user restart radio-scan
```

Both seed a config from `config.example.json` on first install. Uninstall on
macOS with `service/uninstall-macos.sh`; on Linux with
`systemctl --user disable --now radio-scan`.

Note: a user-level service runs while you're logged in, which is right for a
personal logger. Your machine must be awake and online to log — sleep just
leaves a gap.

## What it writes

Per station, under `data_dir/<name>/`:

| File | What it is |
|---|---|
| `acidjazz_log.jsonl` | Raw log — one JSON line per track change (source of truth). |
| `acidjazz_log.csv` | Same data, spreadsheet-friendly. |
| `station_info.txt` | What the stream advertises (name, genre, bitrate, server). |
| `summaries/latest.txt` | The track playing right now. |
| `summaries/YYYY-MM-DD.md` | Per-day summary: top tracks, artists, repeats, by hour. |
| `summaries/week-YYYY-Www.md` | Per-ISO-week summary. |
| `summaries/overall.md` | All-time most-played tracks and artists. |

Each JSONL record has `utc`, `local`, `epoch`, `raw`, `artist`, `title`,
`stream_url`, `prev_airtime_sec` (how long the previous track was on air — handy
for disambiguating a match), and `meta_raw` (the full metadata block).

## Analyse

```bash
python3 radioscan.py stats mystation          # top tracks/artists in the terminal
python3 radioscan.py resummarize mystation    # rebuild all summaries from the raw log
```

(Add `--config config.json` to resolve a station by name, or `--data-dir DIR`.)

## macOS menubar app (RadioBar)

`gui/macos/` ships **RadioBar**, a native SwiftUI menubar app that lets you watch
the logger without a terminal. Click the menubar icon for the current track, the
last few plays, and top artists, with buttons to pause/resume logging and open
the data folder. The icon reflects state — a broadcasting antenna when logging,
slashed when paused. It's a thin **viewer/controller**: it reads the logger's
JSONL output and drives the `launchd` service, and never touches the stream
itself. macOS-only (it depends on SwiftUI/AppKit, which don't exist on Linux).

```bash
cd gui/macos
swift run                       # dev run
./build-app.sh /Applications    # build RadioBar.app + install it (then double-click to launch)
```

See [`gui/macos/README.md`](./gui/macos/README.md) for details. **Note:** it
currently targets the personal single-station deployment (`~/RadioTuner`, launchd
label `com.tigger.acidjazz`); pointing it at `radioscan.py`'s own multi-station
layout (`~/radio-scan-data/<name>/`, label `com.radioscan`) is still on the
to-do list.

## Enrichment

The stream gives you artist + title; to add album/year, run the MusicBrainz
helper (needs internet, no API key):

```bash
python3 enrich/enrich.py ~/radio-scan-data/mystation/acidjazz_log.jsonl
```

It writes an `enriched.csv` with album, year, release type, and a MusicBrainz
link per track. It's a polite client (descriptive User-Agent, ~1 request/sec) —
set a real contact in the script's `CONTACT` if you use it heavily.

## Use it as an agent skill

`skill/SKILL.md` packages this as a skill for Claude / Cowork: given a stream
URL, the agent can probe what's playing, set up logging, and analyse the
rotation. Drop the `skill/` folder into your skills directory (or install it
however your agent loads skills).

## Finding stream URLs

The URL you need is the direct stream/mount, e.g.
`http://host:port/mountname`. If you have a `.m3u`/`.pls`/`.xspf` playlist file
from a station, open it in a text editor — the `http://…` line inside is the
stream URL. Directories like the public Icecast/Shoutcast listings also expose
these.

## Limitations & etiquette

- It logs only what the stream broadcasts. A station that sends no metadata (or
  only a generic "Artist - Title" placeholder) can't be logged meaningfully.
- Streams on arbitrary IPs/ports may be unreachable from sandboxed or
  corporate networks — run it where you can actually reach the stream.
- Be considerate: it holds one connection open rather than hammering the
  server, and identifies itself with a User-Agent. Don't point dozens of
  loggers at one small station.

## License

MIT — see [LICENSE](LICENSE).
