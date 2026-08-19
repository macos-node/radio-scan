# Episodic logging — macOS → Linux handoff (2026-08-19)

Linux takes over the two **episodic** playlist parsers vendored in `0af91ce`.
Everything needed is either in this repo or in Proton Drive; this note is the
whole procedure, including how to tell it worked.

## What is moving, and what is not

| Source | Shape | Owner after this |
|---|---|---|
| **On The Wire** | weekly Blogger feed parse | **Linux** (systemd timer, Mon 09:00) |
| **A Duck in a Tree** | weekly Podbean feed parse | **Linux** (systemd timer, Wed 09:00) |
| **Acid Jazz** | live Icecast ICY, continuous | **stays on macOS** (`com.tigger.acidjazz`) |

The episodic pair derive everything from a public feed, so running them on two
machines produces two independently-built copies of the same rows — hence one
owner. The live logger is the opposite problem (it needs uptime, not a schedule)
and is a separate decision; a VPS is the eventual answer there, not either desktop.

## Why the logs are copied rather than just backfilled

`--all` reconstructs only what a feed still serves. The On The Wire archive
**starts in 1984** and exists because it was accumulated, not because the Blogger
feed still carries it. Copying is what preserves it; the backfill afterwards is
only for anything published since the Mac's last run.

Both are safe to combine: `write_logs()` dedupes on the `episode` field, reading
the existing JSONL first and skipping episodes already present.

## Source of truth for the transfer

Proton Drive, `ntune/radio-scan-logs/` — on Linux that is
`~/Documents/ntune/radio-scan-logs/`. Manifest as staged from macOS:

```
otw:  30,235 rows / 1,276 episodes   1984-10-14 → 2026-08-15
duck:  9,214 rows /   698 episodes   2012-07-14 → 2026-08-15
```

```
871f8820e72429043e371f343458fe7ea49420dcd0edb07f1d03c81d74e061f4  otw/otw_log.jsonl
0dfca1e3cc065016993e97acdd9a5dedfc3dee9b95208c1dd1c6b4ad0bdeb970  otw/otw_log.csv
37f1671be68d993bf73a99a2fd30f60472086c350171d7ca46cd2d7ea9e14873  otw/otw_log.clean.jsonl
5be2fbd8136470962385093d093a383f0adfcabcf842dfdd1f1d01b5a2ed153d  otw/otw_log.clean.csv
5bb99264cf4eedf79787e24929bbfbf5ae0afa67d65c0f92954ddc42b3f45298  duck/duck_log.jsonl
944abd1f98b7b9f3d90658594e6c91b14a9851ba58bdac8f7a1793547e9576c1  duck/duck_log.csv
7c4f1d118a2cd398759a55a18bf1cad59203e84657a430ad9e08a9d046f8b95c  duck/duck_log.clean.jsonl
3590eba5f08089ebe383265cba0151da5ad7ccbfe07ad083e6cdcd8a064aabfd  duck/duck_log.clean.csv
```

## Procedure (Linux)

**1. Verify the transfer before importing anything.**

```bash
cd ~/Documents/ntune/radio-scan-logs && sha256sum -c <<'SUMS'
871f8820e72429043e371f343458fe7ea49420dcd0edb07f1d03c81d74e061f4  otw/otw_log.jsonl
0dfca1e3cc065016993e97acdd9a5dedfc3dee9b95208c1dd1c6b4ad0bdeb970  otw/otw_log.csv
37f1671be68d993bf73a99a2fd30f60472086c350171d7ca46cd2d7ea9e14873  otw/otw_log.clean.jsonl
5be2fbd8136470962385093d093a383f0adfcabcf842dfdd1f1d01b5a2ed153d  otw/otw_log.clean.csv
5bb99264cf4eedf79787e24929bbfbf5ae0afa67d65c0f92954ddc42b3f45298  duck/duck_log.jsonl
944abd1f98b7b9f3d90658594e6c91b14a9851ba58bdac8f7a1793547e9576c1  duck/duck_log.csv
7c4f1d118a2cd398759a55a18bf1cad59203e84657a430ad9e08a9d046f8b95c  duck/duck_log.clean.jsonl
3590eba5f08089ebe383265cba0151da5ad7ccbfe07ad083e6cdcd8a064aabfd  duck/duck_log.clean.csv
SUMS
```

A mismatch here usually means Proton has not finished syncing — wait, don't repair.

**2. Install the timers.**

```bash
cd ~/code_gh/macos-node/radio-scan/service && ./install-linux-episodic.sh
```

Copies the parsers to `~/radio-scan/episodic/`, writes four systemd **user** units,
enables both timers. It prints the next fire times and the follow-up commands.

**3. Import the archive.**

```bash
cp ~/Documents/ntune/radio-scan-logs/otw/*  ~/radio-scan-data/otw/
cp ~/Documents/ntune/radio-scan-logs/duck/* ~/radio-scan-data/duck/
```

**4. Backfill on top — gaps only.**

```bash
python3 ~/radio-scan/episodic/otw_playlist.py  --all --data-dir ~/radio-scan-data
python3 ~/radio-scan/episodic/duck_playlist.py --all --data-dir ~/radio-scan-data
```

**5. Check what it actually did.**

```bash
wc -l ~/radio-scan-data/otw/otw_log.jsonl ~/radio-scan-data/duck/duck_log.jsonl
```

Expected: **30,235** and **9,214**, plus at most a handful of rows for episodes
published since 2026-08-15.

> **The failure mode to watch for.** If a run appends *hundreds* of rows rather
> than a handful, the dedupe key did not match: the key is the `episode` string, so
> a parse producing even slightly different episode names reads the entire archive
> as new. Stop, do not let the timers run, and diff the episode names:
> `python3 -c "import json;print(sorted({json.loads(l)['episode'] for l in open('/home/USER/radio-scan-data/otw/otw_log.jsonl')})[-5:])"`
> against the same on macOS. Recovering is easy (restore the file from Proton);
> re-deriving 1,276 episode names is not.

**6. Only then, on macOS**, stop the duplicate jobs:

```bash
launchctl unload -w ~/Library/LaunchAgents/com.tigger.otwradio.plist
launchctl unload -w ~/Library/LaunchAgents/com.tigger.duckradio.plist
```

`-w` writes a persistent Disabled override so the pause survives reboot — the same
thing RadioBar's own toggle does for episodic shows. Reversible with `load -w`.
Leave `com.tigger.acidjazz` alone.

## Still owed

`Needs-verify: linux` on `0af91ce`: the units are generated and were dry-run
against a stubbed `systemctl`, but **no timer has ever actually fired**. Confirm
with a real firing rather than by inspection:

```bash
systemctl --user start otw-playlist.service && journalctl --user -u otw-playlist -n 20
systemctl --user list-timers otw-playlist.timer duck-playlist.timer
```

RadioBar (macOS) reads these logs and can toggle the launchd jobs, but it does not
run them — quitting it changes nothing. It has no Linux counterpart; on Linux the
logs are files, and ntune is the eventual reader.
