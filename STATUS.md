# radio-scan — project status

_Last updated: 2026-08-11_

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
- **Multi-show toggle (2026-08-10):** RadioBar is no longer single-station. A
  `Show.all` registry drives a picker in the menu (choice persisted in
  UserDefaults). Each show declares `serviceLabel` + `logFile` + a `kind`:
  - `.stream` — a 24/7 Icecast scrape (acidjazz, `com.tigger.acidjazz`,
    `acidjazz_log.jsonl`). Live "now playing"; status **Logging/Paused**;
    **Pause/Resume**.
  - `.episodic` — a weekly archived show whose full tracklist is published per
    episode (On The Wire, `com.tigger.otwradio`, `otw_log.jsonl`, fed by
    `~/RadioTuner/otw_playlist.py`). No live stream: the menu shows the **latest
    captured episode** (name/date/tracks in running order) and **holds it until a
    newer one is captured**. Status **Scheduled/Off**; adds a **Fetch now** button
    (`launchctl start`) to pull this week on demand. The same link/prose filter as
    the parser's `--clean` pass is applied inline so artifacts don't render.
  - Adding a show = one line in `Show.all`. The unified `Track` decoder carries
    both schemas as optionals (stream `local/epoch`, episodic
    `episode/episode_date/pos/label/album`).
- **Third source: "A Duck in a Tree" (2026-08-10).** A weekly ~59-min continuous
  mix podcast by :zoviet\*france: on Podbean, whose show-notes carry a full
  tracklist per episode. Added as a `.episodic` source (`duck`,
  `com.tigger.duckradio`, `duck_log.jsonl`, fed by `~/RadioTuner/duck_playlist.py`,
  weekly Wed 09:00). Unlike On The Wire's Blogger feed, Podbean ships the **entire
  700+ episode archive in one RSS document** — backfill needs no pagination.
  Backfilled **8,301 tracks / 696 episodes, 2012-2026**; the parser mirrors
  `otw_playlist.py` (`--all` / `--no-write` / `--clean`, where `--clean` drops the
  `[anonymous]` intro/outro markers). 40 of 736 (early) episodes predate the
  tracklist format and yield nothing.
- **⚠ `pos` gotcha — episodic logs carry int OR string.** otw's `pos` is an
  integer (`1,2,3`); duck's is a string (`"00","01","++"` — 2-digit index + intro/
  outro markers). RadioBar's `Track.pos` therefore decodes via a `FlexPos` type
  that accepts either, exposing `num` (numeric part, for sorting) and `text`
  (original label, for display). Type `pos` as plain `Int?` and every duck row
  silently fails to decode. Any future episodic source must round-trip through
  `FlexPos`.
- **How the sources behave on launch (independent of RadioBar):** each is a
  per-user LaunchAgent; at login launchd auto-loads every non-disabled plist in
  `~/Library/LaunchAgents`. acidjazz (`RunAtLoad`+`KeepAlive`) starts immediately
  and is kept alive 24/7; otwradio and duckradio (`RunAtLoad`+weekly
  `StartCalendarInterval`, Mon/Wed 09:00) each run once at login then wait for
  their day. All are fully independent processes writing separate logs — RadioBar
  is not required for any of them to log.
- **Pause durability is per-kind (2026-08-10).** RadioBar's toggle chooses the
  `-w` flag by `kind`:
  - `.episodic` → `launchctl load/unload -w` — a pause sets a persistent Disabled
    override and **sticks across reboots** ("pause this show indefinitely"). This
    is the intended default for a weekly show you may want off for a while.
  - `.stream` → `launchctl load/unload` (no `-w`) — a pause is **session-scoped**;
    the next login/reboot auto-loads the plist and the 24/7 logger **resumes**.
    Intentional: an always-on logger should come back on boot.
  `Fetch now` loads episodic jobs with `-w`. So the durable state lives in
  launchd's Disabled override, not in the app — matches the observed machine
  state (otwradio `-w` enabled; acidjazz paused without `-w`, resumes on boot).
- **Coupling to fix:** RadioBar targets the personal deployment (`~/RadioTuner`,
  labels `com.tigger.*`), not `radioscan.py`'s own layout
  (`~/radio-scan-data/<name>/`, label `com.radioscan`) — reconcile when
  generalising to multi-station. The `Show.all` registry is the natural seam to
  move into a `config.json` later.

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
- **U4a (done, Linux-verified):** podcast RSS tab. A Stations|Podcasts tab
  switch; subscribe by feed URL (localStorage), episodes fetched via Rust
  `reqwest` + `feed-rs`, played through the shared player. Playback is
  generalized to a station/episode union (`lib/player.ts`): stations are live
  (ICY now-playing), episodes are seekable + **resume across sessions**. Also
  fixed a proxy bug it exposed: **the proxy now follows HTTP redirects** (podcast
  enclosures almost always 30x through a tracking CDN; `http→http` followed
  internally, `http→https` handed off to the webview) — benefits redirecting
  radio mounts too. Verified on Linux (BBC Global News plays).
  **Known limit:** full **seek on `http` enclosures** needs the proxy to forward
  `Content-Length` + honour `Range` (206); `https` feeds seek fully today.
  `Needs-verify: macos`.
- **Stations vs Podcasts — the two tabs take DIFFERENT URLs (2026-08-10).** A
  **Station** is an audio **stream URL** (Icecast/Shoutcast mount, e.g.
  `http://host:8000/mount`) played straight through `<audio>`. A **Podcast** is an
  **RSS feed URL** parsed by `feed-rs`; you play its per-episode enclosures. Pasting
  a feed/blog URL into *Add station* creates a **dead row** that fails on tune —
  which is exactly how On The Wire (`…blogspot.com/feeds/...?alt=rss`) and A Duck in
  a Tree (`feed.podbean.com/zovietfrance/feed.xml`) got mis-added as stations (both
  removed 2026-08-10). Guard added in `AddStationDialog.tsx`: on Add it probes the
  URL's content-type (reusing `station_icy`); an **explicitly non-audio** type
  (`*/xml`, `rss`, `html`, `json`) shows an amber warning ("looks like a feed… goes
  in the Podcasts tab") and the button becomes **"Add anyway"** (soft block, always
  overridable); **inconclusive** probes (no content-type / probe error) never block
  a genuine stream. So the three logged sources map to ntune as: **Acid Jazz →
  Station** (stream), **A Duck in a Tree → Podcast** (feed; its enclosure URL is the
  join key to `duck_log.audio_url` for the planned bridge), **On The Wire →
  neither** (no raw audio stream exists — log-only in RadioBar).
- **OPML import + Nostr npub detection (2026-08-11).** The Podcasts tab's Import now
  accepts **OPML** (the universal feed-reader export, e.g. from `narr`) as well as
  the app's JSON shape — auto-detected by content (leading `<` ⇒ OPML via
  `DOMParser`), reusing the existing `read_text_file` command (no Rust change).
  Category groups are **flattened**, feeds deduped by url, merged. It's a *general*
  reader export so mixed content is expected — blogs/release feeds import alongside
  podcasts and just show "no audio episodes" when fetched (honest passthrough; no
  audio-only filter yet). `Sub` gained an optional `npub` field: on import, feeds
  served from a Nostr npub (bridges like `castr.me/npub1…/rss.xml`) are detected
  (`/npub1[a-z0-9]{58}/`) and tagged with a subtle **`nostr`** chip. Today they
  still import + play as ordinary RSS via the bridge; the tag is the on-ramp to
  **U4b** (native per-npub `1063` reading — same npub, better source). The per-tab
  Import/Export remain (Stations ↔ `stations.json`, Podcasts ↔ `ntune.podcasts`
  localStorage), each treating the whole file as its own type.
- **App-level Backup & Restore (2026-08-11, v0.1.1-beta.4).** A header **Archive**
  button opens a `BackupDialog` on top of the per-tab imports. **Backup:** *Full
  backup (.json)* = `{app,version,stations,podcasts}` (both stores, one file), or
  *Podcasts (.opml)* = portable OPML for any feed app (`exportText` → same
  `export_file` command, no Rust change). **Restore:** routes **by shape** so the
  user never picks the wrong tab — OPML ⇒ podcasts; a `{stations,podcasts}` object
  ⇒ both stores; a bare array ⇒ stations if entries carry `name`/`slug` (no
  `title`), else podcasts. All merges dedupe by url. Podcast subs moved to a shared
  `lib/podcasts.ts` (Sub type, load/save, `parseOpml`/`parseSubsJson`/`buildOpml`/
  `mergeSubs`, `detectNpub`); `setPodcasts` fires a `ntune:podcasts-changed` window
  event so an open Podcasts tab re-reads after a restore (same-doc localStorage
  writes don't fire `storage`). Station parsing extracted to
  `station.ts::parseStationsJson` (shared by the tab import + restore router).
  Frontend + `cargo` build green; installed. `Needs-verify` in-app: OPML backup
  round-trip, full-backup restore into both stores.
- **Next — U4b:** per-npub `1063` feed tab (reuse the episode model + relay
  layer). Follow-ups: reqwest-based proxy (TLS upstreams + `Range`/seek + `https`
  now-playing); `airplay.v1` emission (menubar-companion direction).
- **Now-playing bridge — producer + macOS consumer BUILT (2026-08-11).** Path table
  frozen/acked by all three sessions; shared file
  `<local_data_dir()>/radio-scan/nowplaying.json`. **Producer** = ntune Rust
  `write_nowplaying` (one uniform `local_data_dir().join(...)` line, no `cfg`) called
  from the existing now-playing effect — verified on macOS (writes on launch/state
  change). **macOS consumer** = RadioBar polls the file (3 s), renders a "▶ Playing
  in ntune" banner, and for episodes joins `r`→`audio_url` to show the located
  episode's tracklist (verified against `duck_log`). **Tauri-tray consumer** (the
  Linux/Windows surface, `tray.rs`) also built — file-polls the same path every 3 s,
  renders the tier-1 banner (no tracklist join off-mac); the in-process
  `emitTrayNowPlaying` event is gone (file is the single source). Producer path
  verified **linux** (`$XDG_DATA_HOME`) **+ windows** (`%LOCALAPPDATA%\radio-scan\nowplaying.json`,
  dir auto-created, writes `playing:false` on launch); tray verified **linux + macos
  + windows** (`compose()` 4/4, default-on tray poll ingests live `playing:true` /
  episode / stopped payloads without panic). **All three platforms verified
  2026-08-11 — bridge fully validated.** Full contract:
  [`gui/tauri/docs/nowplaying-bridge-2026-08-11.md`](gui/tauri/docs/nowplaying-bridge-2026-08-11.md).

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
