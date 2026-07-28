---
name: radio-scan
description: >
  Probe an internet radio stream (Icecast/Shoutcast) to see what it's playing,
  and optionally log its playlist over time. Use when the user gives a stream
  URL and asks what's on, to identify tracks/artists, to monitor or record a
  station's playlist, or to analyse what a stream plays (top tracks, repeats,
  artists). Triggers: "what's playing on <stream url>", "log this radio
  station", "monitor this stream", "what does this stream play".
---

# radio-scan

A tiny standard-library Python tool that reads the "Now Playing" metadata a
radio stream broadcasts, logs each track change with a timestamp, and rolls the
results into daily/weekly summaries. Point it at any Icecast/Shoutcast URL.

## How streams expose the current track

Most Icecast/Shoutcast streams embed metadata *inside the audio*. You request
the stream with the header `Icy-MetaData: 1`; the server replies with an
`icy-metaint: N` header and then, after every N bytes of audio, a small block
containing `StreamTitle='Artist - Title';` (and sometimes `StreamUrl='...';`).
The title only appears when it changes, which gives natural de-duplication.
Some servers instead expose `/status-json.xsl` with the current title. `radioscan.py`
tries the inline method first and falls back to the status page.

Per track you can generally only expect `StreamTitle` ("Artist - Title"). Album,
year, and label are *not* in the stream - derive those afterward (see Enrichment).

## Doing the task

**1. Probe once ("what's playing?")**

```
python3 radioscan.py test <STREAM_URL>
```

Prints the current track, the parsed artist/title, any `StreamUrl`, the raw
metadata block, and writes `station_info.txt` (name/genre/bitrate the station
advertises). Report the track back to the user. If it can't read metadata,
tell them the URL may not expose it or isn't reachable from this machine.

**2. Log over time ("monitor / record this station")**

Ad-hoc, one station:

```
python3 radioscan.py run --url <STREAM_URL> --name <slug>
```

Many stations, from a config file (runs them concurrently):

```
python3 radioscan.py run --config config.json
```

For unattended 24/7 logging, install it as a service (see `service/` in the
repo: `install-macos.sh` for launchd, `install-linux.sh` for systemd). It
reconnects automatically if the stream drops.

**3. Analyse ("what does it play?")**

```
python3 radioscan.py stats <slug>          # top tracks/artists in the terminal
python3 radioscan.py resummarize <slug>    # rebuild daily/weekly/overall markdown
```

Summaries live in `<data_dir>/<slug>/summaries/`. Read `overall.md` for the
shape of the rotation, the dated files for day/week detail.

**4. Enrichment (album/year/label)**

The stream won't give these. To add them, run the MusicBrainz helper:

```
python3 enrich/enrich.py <data_dir>/<slug>/acidjazz_log.jsonl
```

or just look up `artist + title` with web search when a browser tool is available.

## Notes for the agent

- Everything is standard-library Python 3 - no install step.
- A stream URL on an arbitrary IP/port may be unreachable from a sandboxed
  environment; if `test` times out, it usually means network egress is blocked,
  not that the tool is broken - run it where the user can reach the stream.
- Output files are per-station under `data_dir` (default `~/radio-scan-data`).
- Be a polite client: the tool sends a descriptive User-Agent and does not
  hammer the server (it holds one connection open rather than polling).
