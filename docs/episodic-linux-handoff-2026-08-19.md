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

## Why do both — copy AND backfill

**Corrected 2026-08-19.** This doc first claimed `--all` could not reconstruct the
old archive and that copying was what preserved it. That was wrong, and measured
wrong: the Blogger feed serves **1,666 episode dates back to 1980-02-28**, while
the macOS log holds **1,257 back to 1984-10-14**. The feed is the *more* complete
source — 412 episodes it serves never reached the Mac.

The copy still earns its place, for two smaller reasons:

- **3 episodes exist only on the Mac** — posts the feed no longer serves. A pure
  `--all` would lose them.
- It is one file copy against ~70 paginated requests.

So the union is the point, and the order in the procedure gives it: copy first,
then `--all` on top. `write_logs()` dedupes on the `episode` field, reading the
existing JSONL and skipping episodes already present, so combining them is safe.

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
python3 - <<'PY'
import json, os, collections
for src, f in [("otw", "otw_log.jsonl"), ("duck", "duck_log.jsonl")]:
    path = os.path.expanduser(f"~/radio-scan-data/{src}/{f}")
    rows = [json.loads(l) for l in open(path) if l.strip()]
    pairs = collections.Counter((r["episode"], r["pos"]) for r in rows)
    dupes = sum(v - 1 for v in pairs.values() if v > 1)
    print(f"{src}: {len(rows):,} rows | {len({r['episode'] for r in rows})} episodes | "
          f"{dupes} duplicate (episode,pos) rows")
PY
```

**Measured on Linux, 2026-08-19 — expect NO change at all: 30,235 / 9,214.**

The correction above is right that the feed serves more *episodes* than the Mac
logged, and wrong about what that implies for rows. Counting episodes that actually
carry a tracklist:

```
feed episodes served      1,814   (1,674 distinct dates)
  …carrying >= 1 track    1,279
dates in feed, not in log   417
  …carrying >= 1 track       0     <- every one is a pre-tracklist post
```

So `--all` correctly appends **zero rows**: the 417 extra dates are 1980s–2000s
posts from before the tracklist format, and the parser prints each as `0 tracks`.
A large jump is *not* expected here, and treating zero as a failure would be the
same false alarm this section was rewritten to remove, pointing the other way.
Check the row totals against the manifest instead — they should match exactly.

> **The failure mode to watch for is duplication, and row count does not show it.**
> The dedupe key is the `episode` string, so a parse yielding even slightly different
> episode names re-appends episodes already present, and the same track position then
> appears twice under two spellings.
>
> **But do not read a non-zero count as that failure — the baseline is already
> non-zero.** Measured on the untouched macOS archive after import (0 rows added):
> **otw 12 duplicated keys, duck 12**. Neither is an import fault:
>
> - **duck: all 12 are two different tracks at one position**, because `pos` carries
>   markers (`"00"`, `"++"`) that legitimately repeat within an episode — the same
>   `FlexPos` quirk RadioBar had to handle.
> - **otw: 11 of 12 are genuinely identical rows** already in the Mac's log (e.g.
>   `Dub Review - July 2007` listing its tracks twice in the source post).
>
> So the signal is an **increase**, not a value. Record the count before `--all` and
> compare after; unchanged means the union worked however much it grew. Only if it
> climbs should you stop and restore from Proton rather than de-duplicate in place.

**6. Only then, on macOS**, stop the duplicate jobs:

```bash
launchctl unload -w ~/Library/LaunchAgents/com.tigger.otwradio.plist
launchctl unload -w ~/Library/LaunchAgents/com.tigger.duckradio.plist
```

`-w` writes a persistent Disabled override so the pause survives reboot — the same
thing RadioBar's own toggle does for episodic shows. Reversible with `load -w`.
Leave `com.tigger.acidjazz` alone.

## Still owed

~~`Needs-verify: linux` on `0af91ce`~~ — **done 2026-08-19.** Both services were
started for real: `Result=success`, exit 0, and On The Wire parsed a live episode's
23 tracks while correctly appending nothing. Timers are installed and enabled
(otw Mon 09:00, duck Wed 09:00, `Persistent=true`), with `Linger=yes` already set so
they run while logged out.

One note for anyone repeating step 2 → 3: a first-ever `enable --now` does **not**
fire a timer whose `OnCalendar` has already passed this week — `Persistent=true`
replays runs missed while a timer was *already installed*, and a fresh enable has no
recorded last-run. Installing before copying the archive is therefore safe.

RadioBar (macOS) reads these logs and can toggle the launchd jobs, but it does not
run them — quitting it changes nothing. It has no Linux counterpart; on Linux the
logs are files, and ntune is the eventual reader.
