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
- **U0 (done):** Tauri shell, three themes, tune & listen. `https://` streams play
  directly in the webview `<audio>`; **`http://` radio routes through a loopback
  stream proxy** (`src-tauri/src/proxy.rs`, `f1c21e9`) because a packaged app's
  secure origin (`tauri://…`) blocks plain `http://` media as mixed content — a
  bug my dev-only testing missed (dev serves from `http://localhost`, so it never
  bit). No rodio backend needed. **Audio verified on Linux (dev):** Acid Jazz
  (AAC+) audible in `make dev` (webkit2gtk/gstreamer); the `.deb` `Depends` on
  `gstreamer1.0-plugins-bad` + `-libav` so a clean install has sound (§6 canary).
  macOS WKWebView decodes AAC+ natively. **`http://`-via-proxy VERIFIED on Linux**
  in a packaged, secure-origin **release binary** (`target/release/ntune`, built
  via `tauri build`): an `http` MP3 (Drone Zone) and an `http` `audio/aacp` mount
  (Acid Jazz) both play; `https` controls play direct. Two fixes fell out of this:
  webkit2gtk refuses the legacy `audio/aacp` MIME → the proxy now normalizes it to
  `audio/aac`; and `resolveStations` now honors NIP-09 delete timestamps so
  unfollow→refollow works.
  **AppImage caveat:** `tauri build --bundles appimage` ships an *incomplete*
  bundled GStreamer (missing `autoaudiosink`/`appsink`) → the AppImage freezes on
  playback. The **`.deb`** (system-linked + codec `Depends`) is the sound Linux
  artifact; the AppImage needs GStreamer-plugin bundling before it's shippable.
- **U1 (done):** the station list is the user's published `station.v1` (kind
  31241) read off the relays (`relay.fizx.uk` + nos.lol + relay.primal.net), with
  the Rust seed as first-run fallback until U2 publishes any.
- **U2 (done, not yet live-tested):** first write path. Nostr identity in the OS
  keychain (own `ntune`/`ntune-dev` service, mirrors ntree) + `publish_station`
  (kind 31241) and `unfollow_station` (NIP-09 kind:5). Reads/publishes as the
  signed-in pubkey (fallback to the suite owner), so a followed station
  round-trips back through the live subscription. Header identity chip + Follow
  button; import/generate/forget-key dialog; hover-✕ unfollow. Verified
  tsc+vite+`cargo check`; **verified on BOTH platforms**. Linux (`make dev`,
  libsecret): nsec import/read (imported suite npub matches the read filter) **and
  the publish/follow round-trip** — published "Acid Jazz", the live subscription
  read it straight back (header → `1 · station.v1 (relays)`) and it tunes in.
  macOS: the keyring backend needed a **platform-split** (U2 forced
  secret-service everywhere → broken on a clean Mac; fixed `058c1fa` —
  `apple-native` on macOS, `sync-secret-service` on Linux); Keychain round-trip
  verified there, and the Linux build + libsecret backend reconfirmed after the
  split. **Signing path clear on both platforms** — no open release-critical
  `Needs-verify`, so an `ntune-v*` tag is unblocked (contract §3).
- **Build/CI (Linux↔macOS):** `gui/tauri/scripts/{dev,build-install}.sh` (native
  bundle per OS), a tag-triggered `.github/workflows/ntune-release.yml`
  (`ntune-v*`), and `gui/tauri/CONTRIBUTING-cross-session.md` for the split.
- **Release readiness (`ntune-v0.1.0`): CLEAR to tag.** version `0.1.0`; **every
  release-critical path verified on BOTH platforms** — keyring signing, audio
  playback, http-via-proxy (incl. the platform-opposite `audio/aacp` MIME:
  remap→`audio/aac` on Linux only, pass-through on macOS). No open runtime
  `Needs-verify`. AppImage blocker **resolved** (`1e35cff` — dropped from
  `ntune-release.yml`; Linux ships `.deb`-only). The `.deb` is **locally verified
  on Linux**: `tauri build --bundles deb` produces `ntune_0.1.0_amd64.deb` with
  `Depends: gstreamer1.0-plugins-bad, gstreamer1.0-libav, libwebkit2gtk-4.1-0,
  libgtk-3-0` and packages `usr/bin/ntune` + `.desktop` + icons. Ships `.deb`
  (Linux) + `.dmg` (macOS).
- **U3 (done, Linux-verified):** now-playing via the loopback ICY proxy. The
  proxy now requests `Icy-MetaData: 1`, parses the interleaved `StreamTitle`
  (decode ladder UTF-8→Windows-1251→Latin-1, ported from `radioscan.py`), strips
  the metadata so the webview gets clean audio, and emits a `now-playing`
  {url,artist,title} event per track change; the player bar shows ♪ Artist —
  Title. **http-only** (proxied streams); `https` plays direct and shows none.
  Verified on Linux — Acid Jazz shows live track updates, audio stays clean
  (ffprobe). `Needs-verify: macos` (ICY parse on WKWebView).
- **Next — U4:** podcast RSS (`feed-rs`) + per-npub `1063` feed tabs. (Possible
  U3 follow-ups: now-playing for `https` via a TLS proxy path; `airplay.v1`
  emission from the same tap — see the menubar-companion direction.)

## Outstanding
- **Not yet built:** L2 bridge (write `airplay.json` into the shared suite dir +
  reconcile heard tracks vs ndisc's catalogue) and the Nostr publisher/poller.
  The suite-level UI is now **underway** — ntune (§6) is at U0–U2; RadioBar (§5)
  remains a local macOS viewer, not the suite surface. See the build map's open
  decisions (n-alias, dedup window, relay-filterable work key, privacy
  granularity, Python-vs-Rust) and the L4 map's (playback engine, who publishes
  airplay). *RadioBar fate is now resolved* — macOS-native RadioBar stays; the
  cross-platform now-playing surface is a Tauri tray in ntune, a post-`v0.1.0`
  arc ([`gui/tauri/docs/menubar-companion-2026-08-04.md`](gui/tauri/docs/menubar-companion-2026-08-04.md)).

_(The schema drafts under `schema/` are now pushed — commit `98d6175`.)_

## Layout on disk
- `~/RadioTuner/` — the live logger, its data, and `artists.md`.
- `~/code_gh/macos-node/radio-scan/` — the repo (tool + GUI + suite design + schema drafts).
- `/Applications/RadioBar.app` — the installed menubar app (rebuild via `gui/macos/build-app.sh`).
