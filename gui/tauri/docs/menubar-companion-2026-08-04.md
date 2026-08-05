# ntune — menubar / tray "now-playing" companion (direction)

> **Status: DIRECTION — not started.** A post-`ntune-v0.1.0` arc, captured so both
> sessions (macOS `macos-node` + Linux `adjmx`) and future devs share it. This is
> intent, not a spec — open decisions are called out. Phase context: the L4 UI
> build map (`docs/radio-scan-ui-2026-08-04.md`). Cross-session contract:
> [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md).

## The idea
The macOS menubar app **RadioBar** (`gui/macos/`) began as a personal tool to grab
tracklists off one Acid Jazz station. It works well enough that the direction is
to make it a **companion** to ntune: a small always-there surface showing what's
on, click-through to open ntune and tune in — with track logging as a bonus.
Generalize that and it becomes an **n-suite pattern**: a menubar/tray
"now-playing / scrobbler" that **ntune** (radio) and **nplay** (owned music) both use.

RadioBar's arc: *personal logger → ntune's companion → the suite's menubar
now-playing/scrobbler.*

## Why it's coherent — the airplay seam
The menubar now-playing is exactly where radio-scan's thesis lands: *"ndisc
publishes what you own; radio-scan publishes what you hear."* A menubar
now-playing + scrobble is the point where a person's listening becomes an
**`airplay.v1` (kind 31240)** Nostr event (`schema/airplay.v1.json`). So the "nice
logging extra" and the suite's airplay-sensor roadmap are the **same feature**
seen from two ends.

## The Linux task-bar question (the key cross-platform decision)
RadioBar today is **Swift/AppKit → macOS-only**; there is no Linux menubar
equivalent and Swift won't give us one. For **Linux task-bar items** and suite
reuse, the path is **Tauri's cross-platform tray API** (system tray on
macOS/Windows/Linux). Two shapes:

1. **ntune grows a tray mode** — one Tauri app: main window + a tray icon showing
   now-playing, click to focus/open. Cross-platform in one binary, fills the Linux
   gap directly, reuses ntune's existing player state. **Likely the cleanest path.**
2. **A shared suite tray companion** — a small Tauri app ntune and nplay both
   share. More reuse, more moving parts.

Swift RadioBar can remain the macOS-native option, but the cross-platform answer
is Tauri-tray.

## What it watches
To be *ntune's* companion it should reflect ntune's now-playing (the tuned
station), not RadioBar's current coupling to the personal `~/RadioTuner` logger
(launchd `com.tigger.acidjazz`). Reconcile that coupling when this lands.

## nplay
The same component gives nplay a "what's playing" + scrobble for owned music,
feeding the same airplay/scrobble primitives. **One menubar pattern, three
consumers:** ntune (radio), nplay (owned music), the logger.

## Favorites / "like"
When logging or listening live, a **favorite button** marks a track you like — the
"what you hear *and love*" signal on top of "what you hear."

**v1 — local-first curated log (CHOSEN direction).** A favorite writes the
currently-playing track (artist / title / station / timestamp) to a curated
favorites list — a hand-picked subset of the tracklist. No Nostr, no
dependencies; ships with what the logger already knows.

**Later layer — the suite reaction.** Once the airplay layer lands, upgrade a
favorite to the suite's **kind:7 reaction** primitive (the same one
ndisc.blobtree uses on kind:1063), targeting the `airplay.v1` event and ideally
keyed to the **master-release-key (`mrk`)** so likes aggregate per *work* — stable
across stations/formats, not per-random-play.

**Dependency — know what's playing.** You can only favorite the current track if
its identity is available at press time:
- **logger / macOS RadioBar** already parses ICY `StreamTitle` → favorite works
  there now (local log).
- **ntune's player** learns now-playing only at **U3** (the proxy currently strips
  metadata). So a "favorite what's playing" button in ntune / the tray
  **sequences with U3**: *U3 → now-playing → favorite (local) → later kind:7/`mrk`*.

**Where it lives.** The tray companion (quick ❤ on what's playing) + a heart on
ntune's now-playing + "mark favorite" in the logger. One primitive, three surfaces.

## Open decisions
- ~~Swift-native vs Tauri-tray~~ **RESOLVED (2026-08-05):** RadioBar stays
  macOS-native; the cross-platform surface is a Tauri tray in ntune (L4 build map,
  Open-Decision #1).
- Does **ntune** grow the tray, or a **shared** suite tray app?
- **Favorites v1 is local** (chosen); the later reaction *target* is open — kind:7
  on the `airplay.v1` event vs keyed to the `mrk` (lean `mrk`, so likes group per
  *work*).
- `airplay.v1` emission point + privacy posture (local-by-default per the schema draft).
- Where the suite-wide pattern lives long-term (the ndisc `SUITE.md` hub) once it spans repos.
