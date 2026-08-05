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

## Open decisions
- **Swift-native (macOS-only) vs Tauri-tray (cross-platform)** — lean Tauri-tray.
- Does **ntune** grow the tray, or a **shared** suite tray app?
- `airplay.v1` emission point + privacy posture (local-by-default per the schema draft).
- Where the suite-wide pattern lives long-term (the ndisc `SUITE.md` hub) once it spans repos.
