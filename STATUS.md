# radio-scan — project status

_Last updated: 2026-08-04_

A snapshot of where this project stands, for picking it back up (in Claude Code
or elsewhere). Grew from a personal playlist logger into the seed of an
**n-suite** airplay feature.

## 1. The live logger (running)
A dependency-free Python logger reads the ICY `StreamTitle` metadata from the
acidjazz stream (`http://79.111.14.76:8000/acidjazz`) and records every track
change. Installed on the Mac as a launchd service **`com.tigger.acidjazz`** in
`~/RadioTuner`, running 24/7 with auto-restart on reboot. Writes a raw
JSONL/CSV log, per-day/-week/all-time summaries, and `station_info.txt`.

**Data so far (2026-07-28 → 2026-08-01):** ~1,161 plays, ~1,141 unique tracks,
~417 unique artist names (~400 after merging spelling variants). Station is
Icecast 2.4.0-kh4, 320 kbps AAC+; it broadcasts only "Artist - Title" per track.
A generated artist list lives at `~/RadioTuner/artists.md` / `artists.txt`.

## 2. The tool `radio-scan` (built, on GitHub)
The logger generalised into a repo at **github.com/macos-node/radio-scan**
(local: `~/code_gh/macos-node/radio-scan`):
- `radioscan.py` — `test` / `run` / `stats` any Icecast/Shoutcast URL; multi-station config.
- `service/` — macOS launchd + Linux systemd installers.
- `enrich/enrich.py` — MusicBrainz album/year lookup.
- `gui/macos/` — RadioBar, a native macOS menubar app (see §5).
- `gui/tauri/` — **ntune**, the L4 cross-platform desktop tuner/player (see §6).
- `skill/SKILL.md` — agent skill. Plus `README.md`, `.github/workflows/ci.yml`, MIT `LICENSE`.

## 3. n-suite design (notes in the repo)
Mapped in as the suite's first **airplay sensor** — "ndisc publishes what you
*own*; radio-scan publishes what you *hear*" — with a **social layer** (users log
in, share the streams they follow, publish airplay, and interact over Nostr).
- `radio-scan-introduction.md` — suite identity.
- `docs/radio-scan-buildmap-2026-07-28.md` — three layers (L1 sensor / L2 suite
  bridge / L3 Nostr), phased P0–P4, and an open-decisions worklist.
- `docs/radio-scan-ui-2026-08-04.md` — the **L4 UI build map** (the tuner/player;
  resolves the prior map's P4-UI open decision in favour of building it, phases
  U0–U5). See §6.
- `SUITE.md` — placeholder pointing at ndisc's canonical hub (to vendor).

## 4. Wire-contract drafts (proposal, testing-only)
In `schema/` — **not frozen, not SHA-pinned, not vendored**:
- `station.v1.json` (kind **31241**) — a followed stream; URL in `#r` for
  cross-user discovery.
- `airplay.v1.json` (kind **31240**) — an airplay observation; carries the
  suite `mrk` (master-release-key), optional release `a`-ref for the matched
  case, reuses `7`/`31239` for interaction; local-by-default privacy posture.
- `fixtures/` — matched / unmatched / minimal airplay + the acidjazz station.
- Kinds locked against the suite's used set (`1063/4550/27235/30000/31237-9`);
  `mrk` values verified against ndisc's own master-key.v1 vectors (all 15 pass).

## 5. macOS GUI — RadioBar (built)
A native SwiftUI **menubar app** at `gui/macos/` (SwiftPM, min macOS 14). A thin
**viewer/controller** over the logger — reads the JSONL output for now-playing /
recent / top-artists and drives the launchd service (pause/resume); the menubar
icon reflects logging state. Not a stream reader. macOS-only (SwiftUI/AppKit).
- `build-app.sh` assembles a double-clickable, menubar-only `RadioBar.app`
  (unsigned, local-dev); installed at `/Applications/RadioBar.app`.
- CI (`.github/workflows/ci.yml`) builds it on macOS and byte-compiles the Python
  core on Linux.
- **Coupling to fix:** RadioBar targets the personal deployment (`~/RadioTuner`,
  label `com.tigger.acidjazz`), not `radioscan.py`'s own layout
  (`~/radio-scan-data/<name>/`, label `com.radioscan`) — reconcile when
  generalising to multi-station.

## 6. L4 desktop UI — ntune (building)
The suite-level tuner/player at `gui/tauri/` (Tauri 2 + React 19 + TS + Tailwind,
matching nplay/ndisc). Where RadioBar (§5) is a macOS-only *viewer* over the
logger, **ntune is a cross-platform *player*** — the first thing here that
actually listens (the L1 sensor discards audio). Radio-first, with podcast RSS +
per-npub `1063` feeds planned as secondary tabs. Build map + open decisions:
`docs/radio-scan-ui-2026-08-04.md` (phases U0–U5). Developed on Linux; identifier
`uk.fizx.ntune`; suite alias **ntune**.
- **U0 (done):** Tauri shell, three themes, tune & listen. Remote streams play in
  the webview `<audio>` element — no rodio backend needed (confirmed: nplay's
  asset-protocol detour is local-file-only).
- **U1 (done):** the station list is the user's published `station.v1` (kind
  31241) read off the relays (`relay.fizx.uk` + nos.lol + relay.primal.net), with
  the Rust seed as first-run fallback until U2 publishes any.
- **Next — U2:** follow = publish `station.v1` (sign with the keyring `nsec`).
  Then U3 now-playing via a Rust loopback ICY proxy (port of `radioscan.py`), U4
  podcast/npub feed tabs.

## Outstanding
- **Not yet built:** L2 bridge (write `airplay.json` into the shared suite dir +
  reconcile heard tracks vs ndisc's catalogue) and the Nostr publisher/poller.
  The suite-level UI is now **underway** — ntune (§6) is at U0–U1; RadioBar (§5)
  remains a local macOS viewer, not the suite surface. See the build map's open
  decisions (n-alias, dedup window, relay-filterable work key, privacy
  granularity, Python-vs-Rust) and the L4 map's (RadioBar fate, playback engine,
  who publishes airplay).

_(The schema drafts under `schema/` are now pushed — commit `98d6175`.)_

## Layout on disk
- `~/RadioTuner/` — the live logger, its data, and `artists.md`.
- `~/code_gh/macos-node/radio-scan/` — the repo (tool + GUI + suite design + schema drafts).
- `/Applications/RadioBar.app` — the installed menubar app (rebuild via `gui/macos/build-app.sh`).
