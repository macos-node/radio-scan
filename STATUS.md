# radio-scan — project status

_Last updated: 2026-08-17_

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
  (ffprobe). **Verified on macOS 2026-08-05** (`1a51e3c`): ICY parse on WKWebView
  renders live now-playing, proxy strips metadata (valid ADTS AAC, no leak).
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
  **Verified on macOS 2026-08-05** (`aa677a9`): feed fetch → episode list → playback,
  stations unregressed after the player refactor, redirect proxy follows a 302.
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
- **U4b (not started):** per-npub `1063` feed tab (reuse the episode model + relay
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
- **The "make it durable" wave — DONE, all platforms green (2026-08-11/12).** Two
  stores moved off webview `localStorage` into Rust-written files sitting next to
  `stations.json` in `app_data_dir()`, each a synchronous `std::fs::write` so a
  change lands on disk the instant it's made:
  - `podcasts.json` — podcast subscriptions (`4d9d0bf`).
  - `settings.json` — UI prefs: theme, volume, the list/card view toggles
    (`c829a2f`). `localStorage` stays a **mirror** (the `index.html` pre-paint theme
    read needs a synchronous source); the Rust store is authoritative on load.
  Both migrate existing `localStorage` values on first launch. **Why:** WebView2 only
  flushed `localStorage` on a graceful window-close, so a crash / force-kill / OS
  sign-out / tray **Quit** dropped every unflushed change — imported podcasts
  vanished on reopen while file-backed stations survived (Windows-visible, fragile
  everywhere). Fell out of it: **volume now defaults to 0.9 on a fresh install**
  (`a68485c`) — it was silently muted. Verified **macos** (`fabab32`) and **linux**
  (`c6ab30b` — real pre-fix profile: 11 feeds in webkit2gtk `localStorage`,
  no store on disk; new build wrote both files while running (<0.5 s), then `kill -9`
  + a staled `[]` mirror still relaunched to 11 feeds from `podcasts.json`, proving
  XDG resolution and store-wins). Version **0.1.1-beta.4** (tags stop at
  `ntune-v0.1.1-beta.3`). Diagnosis + evidence:
  [`gui/tauri/docs/podcast-persistence-2026-08-11.md`](gui/tauri/docs/podcast-persistence-2026-08-11.md).
- **`Needs-verify` ledger.** `c6ab30b` closed the last *runtime* one. The only item
  still open is the **in-app backup/restore check** on the §6 Backup & Restore
  bullet (OPML backup round-trip, full-backup restore into both stores) — note that
  restore now lands in the durable stores above, so it wants a re-run rather than
  the original check. (The stale `Needs-verify: macos` markers on U3/U4a are
  corrected in place: both were cleared on macOS 2026-08-05, `1a51e3c` / `aa677a9`.)
- **List quality-of-life (2026-08-18).** Two small fixes, both on `main`:
  - **Remove now confirms — podcasts *and* stations.** The hover-✕ removed an entry
    outright with no undo, sitting exactly where the pointer already was, so a stray
    click cost a subscription. All four surfaces (list row + card, both tabs) now
    open a confirm dialog naming the item and its URL, with focus landing on
    **Cancel**. The station dialog states when removal also publishes a `kind:5`
    unfollow (`signedIn` prop from App), since that leaves the *published* list too.
    Escape-to-close went into the shared `Modal`, so all five dialogs gained it.
  - **Sort by recency.** A **Recent | A–Z | Added** switch beside the list/card
    toggle, defaulting to **Recent**. Ordering is display-only (`sortSubs` in
    `lib/podcasts.ts`, unit-tested) — the stored order is never rewritten, so
    **Added** always recovers it; undated feeds sort last, stably. Each feed's
    newest-episode date persists on the sub as `latestAt`, so the order is right on
    the first paint instead of settling as the prefetch trickles in — the **first
    slice of U4.5's harvest persistence** (re-derived on every fetch, feed always
    wins), and it rides through JSON import/export. The pref lives in the durable
    settings store. Two knock-ons: the background prefetch effect is now keyed on the
    sub-URL *set* rather than the `subs` array, since the `latestAt` write would
    otherwise cancel and restart it mid-flight; and **the Rust `PodcastSub` struct had
    to learn the field** — serde drops unknown keys on the way in, so the first
    install wrote a stamp `save_local_podcasts` silently discarded (in-session order
    was right, the store stayed bare). That's the **export serializer-drift U4.5
    exists to close, hit early**: any renderer-side field must be added to the Rust
    struct in the same change.
  Verified in the browser preview (tsc + vite + vitest green; sort order, every ✕
  surface, Escape/Cancel/confirm paths), and in the installed Linux build against the
  real 11-feed profile: confirm dialogs; Recent order correct in-session (which is
  what exposed the serde drop above); and, after the struct fix, **all 11 subs carry
  `latestAt` in `podcasts.json`** — 2026-08-18 back to 2026-08-05, so a cold start
  paints the right order. No open `Needs-verify` on Linux; macOS/Windows unexercised
  (frontend + a serde field, no platform-specific path).
- **Stations vs podcasts on the wire (2026-08-18).** Two podcast feeds were sitting
  on the relays as `station.v1` (`on-the-wire` → a blogspot RSS with **0 enclosures**;
  `a-duck-in-a-tree` → the podbean feed) with **no `kind:5`** ever published, which is
  why they kept reappearing under Stations however often they were removed locally.
  Diagnosed with `nak`: 116 station deletes exist across `relay.fizx.uk`/`nos.lol`,
  none for those two. Duck showed in *both* tabs because the station row and the
  podcast sub use **different hostnames for the byte-identical feed**
  (`feed.podbean.com/...` vs `zovietfrance.podbean.com/...`, both 4,053,739 bytes) and
  dedupe is by URL string. Neither belongs in `station.v1` — `r` is defined as the
  stream mount and `#r` is the relay-filterable cross-user identity. Two things came
  out of it: **`publish_station` now refuses** a conclusively non-audio URL (hard, vs
  the add dialog's soft warning — the relay copy is what others read; inconclusive
  probes still pass), and the underlying gap is recorded as **open decision #10** in
  the v0.2.0 direction doc — *podcast follows have no wire form*, leaning to a sibling
  **`show.v1`** (31242) rather than overloading `station.v1`. **Resolved 2026-08-18,
  in two steps — the first of which only looked like it worked.** The app's `kind:5`
  deletes (`b6835db6fa53` on-the-wire, `a0f86545fcbd` a-duck-in-a-tree) were `a`-only:
  they cleared the *client* view, `resolveStations` yielding 0 relay stations, which
  reads as done. They did **not** clear the wire — `relay.fizx.uk` went on serving
  both target events for another ~10 h, so every other client still saw two untunable
  feeds in the station space. An `e`-tagged `kind:5` published out-of-band
  (`nak --prompt-sec`) finished it; verified by fetching each id from all three relays
  (0/0/0), leaving 5 genuine mounts published. See the NIP-09 bullet below.
- **`show.v1` S4 — FIRST LIVE PUBLISH VERIFIED (2026-08-19, Linux).** Followed
  *No Agenda Show* from the installed build: event `ad61c99d639b…` is on **all three
  relays**, and a `nak` read-back diffs **tag-for-tag identical** to
  [`schema/fixtures/show-31242.guid.json`](schema/fixtures/show-31242.guid.json) —
  `d`/`name`/`r`/`i`/`alt` all match. The `i` value equals the guid read off the feed
  with `curl` on 2026-08-18 **before the extractor existed**, so the chain is proven
  against an independently-known value: quick-xml → `Sub.guid` → NIP-73 tag → signed
  event → relays. **Cross-user discovery measured, not assumed:** a `#i` filter with
  *no author* returns the event on fizx.uk and nos.lol (and `#r` does too) — the
  property that justified a separate kind instead of overloading `station.v1`.
  *One difference:* the fixture carries `t: talk` and nothing emits `t` (no topic UI
  in S3) — settle in S4 by adding a control or dropping it from the fixture.
  **S4 is now CLOSED — verified on both platforms (2026-08-19).** macOS published a
  guid-less show (acast) and found the one bug this slice shipped: a follow published
  mid-session did not mark its own row, because `follow()` keeps no local state and a
  subscription idle since EOSE never delivered the event; fixed with `useFollows`
  `refresh()` (a one-shot `querySync` folded into the same map — optimistic marking
  was rejected, since the chip must not assert a publish the relays might refuse),
  and **stations shared the defect**. Linux then confirmed the fix: *Bitcoin And*
  (`213b1f152f9e`, `i: podcast:guid:43a4f801-…`) published to all three relays and
  **the chip flipped with no restart**. **Cross-machine sync observed:** the resolver
  over live data returns 2 follows — the Linux one plus macOS's McCormack follow,
  which *merges onto the local sub* rather than showing as a relay row. Both
  discovery paths are measured (`#i` Linux, `#r` macOS), and NIP-09 rule 1 held live
  (deleted 12:41, re-published 12:45, resolves followed). Evidence:
  [`docs/show-v1-plumbing-buildmap-2026-08-18.md`](docs/show-v1-plumbing-buildmap-2026-08-18.md)
  § S4.
- **TODO — check the live Acid Jazz logger (noted 2026-08-20, not done).** The one
  piece untouched while the episodic pair moved to Linux and decision #11 landed. It
  stayed on macOS by design (`com.tigger.acidjazz`, uptime not schedule), and nobody
  has looked at it in three weeks: STATUS still records **~1,161 plays over
  2026-07-28 → 2026-08-01**. Unlike the episodic timers, **a gap here is permanent** —
  the station broadcasts only the current track, so there is nothing to backfill from.
  Check running/rows/date-range/gap-shape, then decide where it should live with that
  data in hand (macOS as-is · Linux via `service/install-linux.sh` · a VPS, which the
  episodic handoff already called the eventual answer). Also an input to the unbuilt
  `airplay.v1`: a sensor that is up half the time publishes a misleading picture.
  Checklist: [`docs/live-logger-checkup-todo-2026-08-20.md`](docs/live-logger-checkup-todo-2026-08-20.md).
- **Duplicate Drone Zone row removed; store is 9 rows, 9 events, 1:1 (2026-08-20).**
  Dropped the `http` row (`dronezone`), kept `drone-zone` (`https`) — https plays
  direct while http goes through the loopback proxy, and the merge already displayed
  the https row. All 9 published events now match exactly one local row. The wire's
  `r` for that address still reads `http://…` (it was published from the row now
  removed); harmless — the address is canonical so the match holds — and it would
  only change if that station were unpublished and published again.
  **Worth noting for the next dedupe:** the merge collapsing duplicates on display is
  what made the redundant row **unreachable from the UI**, so this had to be done in
  `stations.json` with the app closed. A "duplicates" affordance, or collapsing in the
  *store* rather than only the view, is the real answer if this recurs.
- **A control query on a DIFFERENT filter proves nothing (2026-08-20).** Sharpens the
  earlier `nak` lesson. nos.lol returned 0 stations across 6 consecutive attempts
  while answering kind:1 and our 10 shows in the same window — which reads exactly
  like "that relay rejected the batch", and I nearly recorded it as such. Re-querying
  minutes later: **9 stations on all three relays, 10 shows on all three, every one
  matched by a local row.** The flakiness is per-query, not per-relay, so a control
  must use the *same* filter before a zero means anything.
- **Linux has published its whole list; macOS handoff written (2026-08-20).**
  `publish all` put **9 station.v1** on all three relays from 10 local rows — correct,
  not a miss: `drone-zone` (https) and `dronezone` (http) are one SomaFM mount, so
  they canonicalise to one address (`da24be21dc42b8e2`) and one event. Runbook for
  the other machine: [`docs/sync-macos-handoff-2026-08-20.md`](docs/sync-macos-handoff-2026-08-20.md).
- **Step 2's merge matched raw URLs — FIXED 2026-08-20, found by using it.** The app
  showed `publish all (1)` that could never reach zero: the merge paired local rows to
  published events by **raw URL string** while the address is **canonical**, so the
  https Drone Zone row never matched the published event (whose `r` is the http one)
  and looked permanently unpublished. Pressing publish would have republished at the
  same address with the other URL, flipping which row appeared published, forever.
  The merge now keys on the canonical URL — which also collapses the display to 9
  rows. Required a **TS canonicaliser** (`lib/address.ts`), and therefore a **fourth**
  implementation of the contract: it runs against every one of the 21 pinned vectors
  (24 tests) exactly as the Rust one does, because a renderer that canonicalises
  differently would decide two devices' rows are different things — this decision's
  own bug, in the reader. 138 TS + 45 Rust green.
  *The local store still holds both Drone Zone rows;* ✕ is device-local now, so
  removing the redundant one is safe and touches nothing on the wire. Left to the
  operator.
- **Decision #11 step 3 BUILT (2026-08-19) — the decision is now complete.**
  `publish all (N)` on Stations, `follow all (N)` on Podcasts, shown only when signed
  in and only when this device holds something unshared. **The open sub-question is
  settled: a device never re-publishes an item it received from the relays** — that
  would restamp an event nobody touched here and could race a machine that just
  unpublished it, resurrecting someone else's removal. No rule needed in code: a
  received row is `relayOnly`, so "local and not yet published" excludes it by
  construction. `lib/publishAll.ts` paces the run (sequential, 400 ms gap, none
  trailing) and **never aborts on one failure** — one unreachable relay must not
  strand the rest — reporting `publishing 3/9…` then `published 7, 2 failed`. Pacing
  is evidence-led: macOS measured hosts rate-limiting an unpaced 31-feed *read* sweep,
  and this writes to three relays per item. 7 tests, incl. two pinning properties
  rather than output (publishes never overlap; the pause falls between items, not
  after the last). 114 TS + 45 Rust green.
- **Decision #11 step 2 BUILT (2026-08-19) — both halves.**
  **(a) Station ✕ / publish split.** Stations were the last place local housekeeping
  and a public act shared one control. `publish`/`published` is now a toggle
  (`publishStationRow` / `unpublishStation` in App), ✕ is device-local, and a
  relay-only row has no ✕ — mirroring the Podcasts tab exactly, including the
  asymmetric confirms (publish is one click; unpublish asks, because it writes a
  deletion to every relay). Needed two supporting changes: `Station.relayOnly`, set by
  App's merge from the local URL set, and the merge now carries the published event's
  `d` across the local-wins dedupe as well as its `eventId` — without `d` a retraction
  cannot name what it deletes (the `468aff7` lesson).
  **(b) Superseded-address detection** — the reader-side check adopted in answer to
  macOS's version-skew question. `supersededAddresses()` in `lib/addressable.ts`
  reports any target holding two live addresses, matching on `i` before `r` so
  podbean's two hostnames don't hide it, keeping the newest and flagging the rest;
  `useFollows` runs it across both kinds and App shows one warning above the lists.
  This is the check that needs no foreknowledge and works retroactively — the
  2026-08-19 skew was caught only because the expected hashes had been computed by
  hand. 5 tests, incl. the exact incident shape.
  Verified in the preview across all three row states (local-only → `publish` + ✕;
  published-here → toggle + ✕; from-another-device → toggle, no ✕) and all three
  dialogs, each saying something different and correct; plus the warning rendering
  from a simulated stale publisher. 107 TS + 45 Rust green. **Step 3 ("publish my
  list") outstanding.**
- **Step 1 had a retraction bug — found and fixed by macOS (`468aff7`), verified
  here.** My unfollow paths re-derived `d` from the URL/guid, which is correct only
  while the format never changes — and #11 changed it, so every follow published
  before step 1 became unretractable from the app the moment step 1 landed. Worse
  than unretractable: one click published a `kind:5` naming the **new** address in
  `a` while its `e` named the **old** event, so `relay.fizx.uk` (deletes by id)
  dropped the orphan while nos.lol and primal (delete by address) tombstoned the
  **good** follow. Different, worse outcome per relay; the orphans needed `nak` to
  clear because nothing in the app could name them. Fixed by carrying the event's own
  `d` verbatim on `Show`/`Station` and retracting at it, deriving only for local-only
  rows. **My migration instructions in the decision doc were the trigger** and are
  corrected in place rather than quietly edited. Verified on Linux: 45 Rust + 102 TS
  green, and the live events' `d` is carried verbatim through the read path. *Not
  reproducible here:* the wire holds no pre-#11 event any more — macOS had the only
  two and both are migrated (`070f66ab867bb7ce`, `f5a81dadd784fbf5`, on all three
  relays).
- **Version skew — answered (2026-08-19).** macOS's build was 5h behind step 1 and
  republished both follows in the old format; relays accepted them and the UI looked
  right. **Adopted:** the reader-side check — two `show.v1` sharing an `r`/`i` (or two
  stations sharing an `r`) are one show at two addresses, which is never legitimate;
  show one row flagged needs-migration. No contract change, retroactive, would have
  caught this without foreknowledge. Lands with **step 2**. **Declined for now:** a
  `dfmt` marker — a build predating it cannot emit one, so it could not have caught
  the incident that prompted it, and for this transition the format is already
  self-describing (word-slug vs exactly 16 hex). Revisit if a future change is
  hash-to-hash.
- **Decision #11 ACCEPTED; step 1 (content-derived addressing) BUILT 2026-08-19.**
  A follow's `d` now comes from what it points at, not what the user typed:
  `airplay:station:` + first 16 hex of SHA-256 of the **canonical stream URL**, and
  `airplay:show:` + the same over the feed's `<podcast:guid>` when stated, else its
  canonical URL. Same stream ⇒ same replaceable address on every device, so the
  four-events-for-one-station bug cannot recur. **The gate held:** the Rust
  implementation reproduced all 21 pinned vectors first time — a third independent
  implementation after macOS's and the Python reference, which is what the vectors
  file is for. Three property tests back it (one stream = one address however
  written; case/port/query variants must NOT merge; a show's guid outranks its host).
  **`uniqueShowSlug` and its `-2` suffix are deleted** — collisions are impossible
  once the address is content-derived, and that suffix *was* the duplication bug.
  Contracts updated (`d.format` + a `vectors` pointer in both), fixtures re-addressed,
  and the fixture test now asserts `d == show_d(guid,url)` so a hand-written address
  fails rather than being blessed — verified by mutation.
  **Migration, deliberately manual:** the 2 published shows re-address
  (`the-peter-mccormack-show` → `f5a81dadd784fbf5` url-derived,
  `bitcoin-and-bitcoin-economic-news` → `070f66ab867bb7ce` guid-derived). Toggle
  `following` off then on for each; the retraction still finds the old event via its
  `e` tag, which is why the 2026-08-19 `e`-tag fix had to land first — an `a`-only
  retraction would now compute the new address and orphan the old event permanently.
  **Steps 2–3 outstanding:** station ✕/publish separation, then "publish my list".
- **Multi-device sync — DECISION DRAFTED, nothing built (2026-08-19).** "Acid Jazz is
  missing on Linux" turned out not to be a sync failure: it was never in this
  machine's local store, arrived only via the relay overlay, and that copy had been
  deleted on 08-06 — ntune had been filtering it client-side ever since, so today's
  retraction merely made the wire agree. The investigation underneath is the value:
  (1) **nothing publishes local items** — 10 stations here, 0 on the relays; (2) **`d`
  is derived from the typed name**, so one station gets several addresses across
  devices — `acid-jazz`/`acid-jazz-2`/`acid-j`/`aj` were that bug, not experiments;
  (3) **URL equality ≠ stream identity** — `drone-zone` and `dronezone` are the same
  SomaFM mount over https and http. Podcasts mostly escape this because
  `mergeFollows` prefers `podcast:guid` (7/10 carry one) — decision #10's
  URL-independence argument, which stations lack. *Proposal:* canonical-URL-hashed
  `d`, per-item events with removal and publication kept separate, explicit "publish
  my list"; NIP-51 sets rejected for now because last-writer-wins across devices turns
  a duplication bug into an omission bug. Measured: canonical addressing collapses
  10 station rows → 9 streams, leaves 10/10 podcasts. **Cheapest moment to change
  `d`: 2 published events exist.** Doc:
  [`docs/multi-device-sync-decision-2026-08-19.md`](docs/multi-device-sync-decision-2026-08-19.md),
  open decision #11.
- **Stale station tombstones CLEARED from the wire — 2026-08-19.** The five
  acid-jazz naming experiments (`abstract-hiphop`, `acid-jazz-2`, `acid-j`, `aj`,
  `acid-jazz`, published 08-05/08-06) had survived their `a`-only deletions on
  `relay.fizx.uk` and were still being served to any client that did not filter
  client-side. Retracted with a single `kind:5` naming all five by **event id**,
  published from the operator's key via `nak … --prompt-sec` (interactive, so the
  nsec stayed out of shell history and `/proc/<pid>/cmdline`). Verified after: **0
  station.v1 across 5 reads on each of the three relays**, and each id queried
  directly returns nothing — with a control query in the same window (releases 10,
  shows 2, profile 1) proving the relay was answering, not merely quiet. The
  published set is now exactly 2 `show.v1` and 0 stations.
  This also closes the loop on the finding below: the `e` tag `24c874d` added is what
  made these clearable at all — an `a`-only retraction had already been accepted and
  ignored by this relay.
- **`relay.fizx.uk` health — my earlier "serving nothing" call was WRONG.** I
  reported the relay up-but-answering-nothing, partly on `kind:1` returning zero.
  That is a genuine empty result on a personal relay that holds no notes, not a
  symptom: it serves every kind the operator publishes (profile, 31237 releases,
  31238 labels, stations, shows), and the operator's own publishing was accepted 3/3
  all day. What is real is that **reads flap** — 27 consecutive empty station queries,
  then all four capture forms returning 5 seconds later. I also twice blamed the
  `nak` invocation form (pipeline vs command substitution); testing all four in one
  window disproved it. **Lesson, recorded because it recurred:** a broken or
  mis-scoped probe reads exactly like a real negative. Three instances today — an
  empty `nak` capture read as "resolves 0 shows", a `head -1` survey read as "no feed
  carries funding", and a `--since` timestamp **in the future** read as "the deletion
  did not land". Run a control query before believing a zero.
- **NIP-09: the `e` tag is what makes deletion work on `relay.fizx.uk` — MEASURED
  2026-08-19.** The unfollow of the show above published `b85b4216a2a2` with **both**
  targets (`a` coordinate + `e` id `ad61c99d…`) to all three relays, and **fizx.uk
  dropped the event**: 0 `show.v1` served, `#i` discovery returns nothing. The same
  session is its own control group — the stations deleted with `a`-only tags on
  08-06/08-18 were **still served** by that relay, while nos.lol has 0 of both.
  (*Correction, macOS:* the count read 5 rather than 7 not because of
  replaceable-dedupe — all 7 carried distinct `d` values — but because the macOS
  session had cleared 2 of them hours earlier with an `e`-tagged `kind:5`; see the
  station-side A/B below. The 5 that remain are the genuine mounts.) Same relay, same author, same day, one variable. This turns
  the 2026-08-18 *inference* into a measurement and validates `24c874d` on live
  infrastructure. **Two consequences:** (1) tagging both targets is **required in
  practice** for the suite's own hub — any future retractable kind should do it from
  day one, and that belongs in the schema conventions, not just in the two unfollow
  commands; (2) those **5 station tombstones are still live on the hub** — invisible
  in ntune (client-side filtering) but visible to any other client, and they clear
  only by re-following/re-unfollowing with the current build or by fixing NIP-09
  server-side (root is macOS-only).
- **The 2026-08-19 fix batch — macOS pass, VERIFIED (2026-08-19).** All of
  `70a8c25`, `77bd4a4` and `b34a842` exercised on the 25-sub profile:
  - **Harvest lag fix.** Stripped `ownerEmail`/`funding`/`valueAddress` from **18 of
    25** subs, relaunched, never opened the Podcasts tab — the startup pass restored
    **15/9/5 within ~5 s**.
  - **Owner-precedence fix: correct, but was unreachable.** It resolves
    `<itunes:owner>` over `<managingEditor>` on a genuine re-parse — except
    `FEED_CACHE_VERSION` stayed at 4, so no cached feed re-parses, and the new
    healing pass **re-asserted the stale `contact@taz0.org` on every launch**.
    Isolated rather than inferred: strip-and-relaunch restored the old value from
    cache; deleting that one cache entry and refetching produced
    `bitstream@taz0.org`. Bumped to 5 in `72f616d`.
  - **`following` is a toggle now (`77bd4a4`).** Toggling TFTC off published
    `cd0fe5abfb47` with **both** targets (`a` coordinate + `e`
    `66c9b9d55518…`), live `show.v1` went 3 → 2 on all three relays, and **TFTC
    stayed subscribed** with its guid, `latestAt` and harvest intact — the S4
    affordance gap, closed and measured.
  - **First macOS follow carrying an `i` tag.** TFTC published
    `i=podcast:guid:e22a2294-…`, matching both the harvested `Sub.guid` and the value
    read off the raw feed with `curl` before the extractor existed — so
    feed → quick-xml → store → NIP-73 tag → relay is now closed on this platform too
    (macOS had only ever published the guid-less path).
  - **Enrich editor (`b34a842`).** A saved value lands as
    `{"author": "…", "editedAt": …}` with no empty strings, and **survives a relaunch**
    — the startup fold rewrites `harvest` wholesale without touching `enrich`. Both
    halves of the rule checked against the real store via `podcastIdentity()`:
    dormant where the feed states the field (`fromUser: []`), surfaced and attributed
    where it does not (`fromUser: ["copyright"]`), and dormant again if the feed later
    starts stating it.
- **U4.5 H3 — macOS pass: podcasts exact, stations lag the store (2026-08-19).**
  Exported both lists from the installed build and diffed them against the store.
  **Podcasts: 25/25 subs with harvest slices byte-identical**, 12 guids and every
  `latestAt` preserved. **Stations: `eventId` correctly absent, but all three harvest
  slices were dropped** — the export was written mid-session.
  **`toExportStation` is not at fault** (`if (s.harvest) out.harvest = s.harvest`).
  After a probe, [`App.tsx:379`](gui/tauri/src/App.tsx:379) calls `setStationHarvest`,
  which writes through to the Rust store but **never updates the `localStations`
  React state**; the export maps over that state, so it serialises rows that have no
  slice in memory. Re-exporting **after a relaunch** produced a byte-exact match
  (1486 → 2057 bytes, 3/3 slices) — so it is lag, not loss, and `stations.json` was
  never wrong.
  **Why the guard did not catch it:** `station.test.ts:172` calls `toExportStation`
  on a hand-built station that already carries a harvest, so the "walks every
  persisted field" test passes while the real export path never sees a
  harvest-bearing `Station`. The test checks the serializer; the defect is one layer
  up.
  **This is the second instance of one pattern, not a separate bug.** The podcast
  harvest lags the same way (see H1 above, finding 2): something is persisted through
  Rust, the React state that mirrors it is not updated, and whatever reads from state
  — the export, the row's chip — is stale until a remount or restart. H3's promise is
  *export == persisted state*; what it delivers today is *export == in-memory state*.
  The `useFollows.refresh()` fix (`8330464`) closed the same shape for published
  follows; the store-backed slices want the equivalent.
- **U4.5 H2 — macOS pass, VERIFIED against the wire (2026-08-19).** Three stations
  probed and persisted, checked by reading each stream's ICY headers with `curl`
  rather than by trusting the app: **SomaFM Indie Pop Rocks 5/5** (`icy-name`
  "SomaFM presents: Indie Pop Rocks! [SomaFM]", `icy-genre` "Indie LoFi College",
  `icy-br` 128, `icy-url` `http://somafm.com/recent?indie`, `Content-Type`
  `audio/mpeg`), **Groove Salad 5/5** — homepage stored with its original
  capitalisation (`http://SomaFM.com`) rather than normalised. **Acid Jazz is the
  useful case:** that stream sends only `icy-br: 320` and `Content-Type: audio/aacp`,
  no name/genre/url, and the slice is exactly `{bitrate, fmt}` — absent stays absent
  on a station too. **The inverted rule holds:** both SomaFM rows keep the operator's
  typed name rather than the `icy-name` banner, and Acid Jazz's stored `bitrate: 0`
  was not overwritten by the probed 320 — the probe lands in the harvest slice, the
  row stays the user's.
- **U4.5 H1 + H5 — macOS pass, VERIFIED with two findings (2026-08-19).** A 25-sub
  profile, checked field-by-field against an **independent parse of the raw XML**
  (channel-level only, `<itunes:owner><itunes:email>` with a `<managingEditor>`
  fallback, `<podcast:funding url>`, highest-split `<podcast:valueRecipient>` skipping
  `type="node"`) rather than against the app's own extractor:
  - **funding 9/9 exact**, **lightning 4/4 exact plus a 5th the app found and the
    hand-parse missed** (No Agenda's `<podcast:value>` layout); splits stored are
    98/93/90/98/99, so highest-split and the node-skip both hold.
  - **owner email 15/15** once the harvest completed — 2.5× the Linux sample's 6.
  - **Absent stays absent:** not one field across 25 subs is stored as `""` or `[]`.
  - **Finding 1 — the implementation disagrees with its own doc comment.** `lib.rs`
    says the source is "`<itunes:owner><itunes:email>`, else `<managingEditor>`", but
    the scan keeps **whichever appears first in document order**. Cypherpunk Bitstream
    states `<managingEditor>contact@taz0.org` at byte 415 and `<itunes:email>
    bitstream@taz0.org` at 986, and the app stores the **editorial contact** rather
    than the owner. Confirmed by running `extract_channel_extras` over the real feed
    bytes, not inferred. Either the comment or the precedence is wrong; the itunes tag
    is the podcast-native one, so the comment is probably right.
  - **Finding 2 — the stored harvest lags the cache until the tab remounts.** A fetch
    resolving after `PodcastTab` unmounts writes the feed-cache (Rust) but never the
    subscription store, because the persistence effect only runs while the tab is
    mounted. Measured: 8 of 25 subs carried the single earliest `harvest.fetchedAt`
    while their cache was fetched up to 5 minutes later, and **Syntax's `ownerEmail`
    existed in the cache but not in the store**. Switching tabs and back healed it
    (15/15, store == cached parse). Not permanent data loss, but H3's promise is
    *export == persisted state*, and a profile exported without revisiting the tab
    ships a thinner store than the app already knows about. Only one field was lost
    here because the other 7 late feeds are zero-enclosure blogs with nothing extra to
    state — which is why a smaller profile would not have caught it.
  **Still `Needs-verify: macos`** for H2 (needs a station tuned in to probe ICY) and
  H3's export round-trip (needs the backup dialog). H4 ships no editor, so its data
  model is covered by the suite: 90 TS + 33 Rust green here.
- **`show.v1` S0 — macOS pass, VERIFIED 2026-08-19.** The guid harvest and the cache
  version gate both hold on a second platform and a larger, hostile profile: 29 subs
  whose cached bodies all predated the extractor and all carried live ETags — exactly
  the case that would 304 forever and return a guid-less parse if `FEED_CACHE_VERSION`
  were not honoured. **All 29 re-fetched and now read `v: 2`; 16/29 carry a guid**, 13
  legitimately publish none. **Conformance is against outside values, not self-
  consistency:** four guids had been read off the live feeds with `curl` on 2026-08-18,
  *before* the extractor existed (`43a4f801…` Bitcoin And, `2d0d7fdd…` Once Bitten!,
  `e22a2294…` TFTC, `28e3b6e8…` Closed Network) — the build reproduces all four
  exactly. `latestAt` (24/29) and the Recent order survived the full cache
  invalidation. **Still `Needs-verify: macos`** for S1–S4: all three relays currently
  serve **0** `show.v1` (the S4 event was published then unfollowed), so the in-app
  `following` render needs a fresh signed follow — the operator's call, not a code
  question. *(Build note: `tauri build` failed its **dmg** step twice on 2026-08-19
  — `bundle_dmg.sh` died after writing the intermediate `rw.*.dmg`, while `ntune.app`
  bundled fine — and has succeeded on every run since, four in a row, including from
  the same sandboxed shell that saw the failures. **Cause unknown.** Two hypotheses
  were tested and both are wrong: it is not the sandbox (the dmg builds there), and it
  is not the leftover `rw.*.dmg` debris (planting one does not reproduce it). Tauri
  swallows the script's stderr, so there is no diagnostic. Treat a one-off dmg failure
  as unexplained rather than as a release blocker — `ntune.app` is unaffected and
  release dmgs come from CI — but if it returns, capture `bundle_dmg.sh` stderr
  directly, since that is the missing evidence.)*
- **`show.v1` S1–S4 — macOS pass, VERIFIED with one bug (2026-08-19).** Followed
  *The Peter McCormack Show* from the installed build: `de61654e9d48…` is on **all
  three relays**, tags `d`/`name`/`r`/`alt`. **No `i` tag, correctly** — acast states
  no `<podcast:guid>` (one of this profile's 13 blanks), so this is the **minimal
  legal record**, structurally the Duck fixture. That makes it the complement of the
  Linux S4 run, which published a show *with* a guid: **cross-user discovery is now
  measured on both paths** — `#i` there, and here a `#r` filter with **no author**
  returning the event on all three relays. Slug clean (no `-2`), no `kind:5` names it.
  **BUG — a follow published mid-session does not mark its own row.** The chip stayed
  `follow` after publishing and only flipped to `following` after a **restart**. The
  pure layer is not at fault: replaying the live event and the real 25-sub store
  through `parseShow` → `resolveShows` → `mergeFollows` yields 25 rows with exactly
  one carrying a `show`, matched onto the **local** sub (not appended `relayOnly`).
  So parse/resolve/merge are correct and the gap is in the **read-back**: `follow()`
  deliberately keeps no local state — *"the live subscription reads the event straight
  back"* — but the already-EOSE'd `useFollows` subscription (open ~9 min at publish
  time) never surfaced it. **Suspect the same applies to stations**, since the comment
  says "exactly as stations do" and the code path is shared; it is invisible there
  because the local store already renders the row and only the *published* marker
  lags. Fix candidates: refetch after `publishShow`/`publishStation` returns, or mark
  optimistically from the returned event rather than waiting on a relay push.
- **The duplicate-pair count, measured (macOS, 2026-08-19).** With guids now
  harvested, the 29-sub profile resolves to **exactly four duplicate groups**, 8 rows:
  Bitcoin And (podhome = soundcloud), Once Bitten! and TFTC (fountain.fm = anchor.fm),
  Closed Network Privacy (yellowball = anchor.fm). The 13 guid-less subs were checked
  for content-duplicates and have none, so guid dedupe would collapse **all** of the
  library's duplication and nothing else. Until a dedupe slice lands the rows stay
  visible — `mergeFollows` maps `subs` 1:1 — so the interim fix is removing one of each
  pair by hand.
- **`show.v1` follow-ups (open, none blocking).** (1) The fixture carries `t: talk`
  but nothing emits `t` — no topic UI; add a control or drop it from the fixture.
  (2) **✕ unsubscribes AND unfollows in one gesture** (hit on both platforms): local
  housekeeping and a public act share a control, and the `following` chip is not a
  toggle — likely fix is making it one. (3) The stale tombstones on `relay.fizx.uk`
  plus the macOS-recorded state the app cannot exit (a deleted station's row is
  hidden, so no ✕ remains to re-issue from, while the publish guard blocks re-adding
  it to get a fresh event).
- **`t` fixture mismatch — RESOLVED 2026-08-19 (dropped, not implemented).** Both
  `show-31242.*` fixtures advertised topic tags ntune has no way to emit. Deriving
  them was rejected on both available sources: the **feed's** categories are harvest
  and `show.v1` keeps harvest off the wire, and the **user's** categories are typed
  into a private notes dialog — publishing those to relays unasked would be a real
  surprise. `t` stays accepted in the contract with a note explaining the gap; a
  deliberate topic control is the way in. **The test was the weaker half:** the
  fixture-diff fed the fixture's own `t` values back into `show_tags`, making it
  self-consistent rather than true, so it stayed green while the fixture over-
  promised. It now builds with **no topics — what `publish_show` is actually called
  with** — and was verified by reinserting the bogus tag and watching it fail.
  Same shape as the H3 export guard: a test can check one layer and miss the defect
  in the layer that matters.
- **✕ / unfollow conflation — FIXED + Linux-verified (2026-08-19).** The S4
  affordance gap, hit on both platforms: ✕ on a published row unsubscribed *and*
  unfollowed, so local housekeeping and a public retraction shared one control.
  `following` is now a **toggle** (retracts the follow, subscription untouched); ✕ is
  **local only**; a relay-only row shows no ✕ (nothing local to remove). Asymmetric
  confirms by design — following is additive and one click, **unfollowing asks**,
  since it publishes a kind:5 to every relay. Verified by driving all three row types
  in the preview: subscribed+followed (both controls), subscribed-only (`follow` + ✕),
  relay-only (`following`, no ✕); the unfollow dialog names the address and promises
  the subscription stays; and unsubscribing a followed show removed it from the store
  while the row **remained, re-marked `relay`** — exactly what its dialog said would
  happen.
- **Enrich editor — BUILT + Linux-verified (2026-08-19).** H4 shipped the model,
  merge and persistence with no way in; this is the way in. `EnrichDialog` (7 fields)
  reached from the identity row via **fill in** / **edit**, backed by a module-level
  `setEnrich()` alongside `absorbPodcast()` — same rule, the store is not a rendering
  concern. **The screen teaches the rule:** a field the feed states is dimmed and
  quotes the feed's value, with "yours stays stored and shows only if the feed
  stops", because typing there and seeing nothing change would otherwise read as
  broken. Blanks are dropped (never stored as `""`), clearing everything removes the
  slice rather than leaving `{}` in every export, and an unchanged save does not
  rewrite the store or bump `editedAt`.
  Verified by driving the real UI: filling a feed-silent show stored + displayed the
  values (categories split/trimmed, empty entry dropped) and left `harvest`
  untouched; on a feed that states things, a typed author was **stored yet hidden**
  while the feed's author kept showing, and a typed email — a field the feed left
  empty — appeared immediately. 104 TS + 35 Rust green. **The `fill in` affordance
  deliberately appears even when a show states nothing** — that is exactly the show
  worth annotating, and the identity row used to render nothing at all in that case.
- **Episodic logging moved to Linux — DONE 2026-08-19.** Ran the
  [handoff runbook](docs/episodic-linux-handoff-2026-08-19.md): 8/8 checksums OK;
  archive imported and re-verified (**otw 30,235 rows / 1,276 episodes,
  1984-10-14 → 2026-08-15**; **duck 9,214 / 698, 2012-07-14 → 2026-08-15**); both
  `--all` backfills added **0 rows**, so the `episode` dedupe key matched exactly and
  the doc's expensive failure mode did not occur. Timers live at `~/.config/systemd/
  user/` (otw Mon 09:00, duck Wed 09:00, `Persistent=true`), `Linger=yes` already set
  so they run logged out. **Closes `Needs-verify: linux` on `0af91ce`:** both services
  were fired for real — `Result=success`, exit 0, otw parsed a live episode's 23
  tracks and correctly appended nothing. *Deviation:* I copied the archive **before**
  installing the timers, expecting duck's already-past `Wed 09:00` + `Persistent=true`
  to fire on enable and race the copy. It does not — a first-ever enable has no
  recorded last-run to replay — so the doc's order was fine and mine was equivalent.
  **Remaining (macOS):** `launchctl unload -w` the two episodic plists; until then
  both machines log the same shows independently.
- **The startup healing pass was re-asserting stale parses — FIXED 2026-08-19.**
  Found while verifying the v5 bump on Linux: the re-fetch is tab-driven, so a launch
  that never opens the Podcasts tab leaves the cache at the old version — and my
  sweep folded those **older-parser bodies** into the store on every launch, exactly
  the "makes it worse rather than better" `72f616d` warned about. The version bump
  fixed *reachability*; this was a second, independent way for a parser fix to stay
  invisible. `cached_podcasts` now returns each body marked `stale` (computed where
  `FEED_CACHE_VERSION` lives, so the renderer never needs the constant); both the
  sweep and the tab's disk-prime **paint** a stale body but never **store** it.
  Proven by planting a sentinel value in the store and relaunching against the v4
  cache: it survived, where before it would have been overwritten. 39 Rust + 104 TS.
- **macOS pass on U4.5 found three defects — all fixed + Linux-verified
  (2026-08-19).** The pass checked stored fields against an independent parse of the
  raw XML rather than against the app's own extractor, which is why it found things a
  green suite did not.
  1. **Owner vs editor.** `extract_channel_extras` kept whichever contact appeared
     FIRST; Cypherpunk Bitstream states `managingEditor` at byte 415 and
     `itunes:email` at 986, so the editorial contact was stored as the owner.
     Precedence is now resolved after the scan (owner wins; editor only stands in) —
     2 tests, both document orders.
  2. **Harvest lag.** The reconcile was a `useEffect` in `PodcastTab`, so a fetch
     resolving after unmount wrote the Rust feed-cache and never the store: 8 of 25
     macOS subs stuck on the earliest `fetchedAt`, one ownerEmail in the cache with
     no counterpart in the store. Now a module-level `absorbPodcast()` (no view
     attached) plus a **startup sweep** that folds the cache into the store.
     Verified by stripping owner/funding/value from 9 subs and relaunching **without
     opening the tab** — all restored.
  3. **Mid-session station export dropped every slice.** `setStationHarvest` wrote
     through to Rust but never updated `localStations`, and the export maps over
     that state. App now re-reads the store after a probe — same shape as
     `useFollows.refresh()`. Verified end-to-end on the real timeline: app launched
     17:01:35, Boot Liquor probed 17:02:51, export written 17:06:43 **with no
     relaunch** — 3/3 slices identical to the store, `eventId` leaked 0.
  **macOS's own framing is the durable lesson:** 2 and 3 are one pattern, not two
  bugs — something is persisted through Rust, the React mirror is not updated, and
  whatever reads from state is stale until a remount. Worth checking any future
  write-through against it.
  **Two bugs I introduced while fixing these**, both caught by the suite within
  minutes: `saveSubs` called `localStorage` and `invoke` unguarded (unlike
  `settings.ts`), and a blanket replace left `notifyPodcastsChanged` calling itself —
  infinite recursion that would have thrown on **every podcast save**.
  **Known limit, recorded rather than papered over:** H3's export guard tests
  `toExportStation` against a hand-built station that already carries a harvest, so
  it validates the serializer while never exercising the state→export path where the
  defect lived. Closing that needs component-level tests; the suite has no setup for
  them (`environment: node`, no jsdom).
- **U4.5 H5 — funding + lightning address (2026-08-19, Linux-verified). U4.5 IS
  COMPLETE; the v0.2.0 definition of done is MET on Linux.** `<podcast:funding>` and
  the top `<podcast:value>` lnaddress join the harvest slice — **stored, never acted
  on** (U4's no-payments line holds). `type="node"` recipients are skipped as keysend
  plumbing. Measured: funding 5/10, lnaddress 3/10, each the top split (2%/7% platform
  cuts correctly passed over); Bitcoin And stores funding and no address because its
  only recipient is a node — the designed-for case. `FEED_CACHE_VERSION` → 4.
  **Two process notes.** My first survey concluded "no feed carries funding" — an
  artifact of `head -1` reading one line of pretty-printed XML instead of everything
  before `<item>`; the real answer was 5/10. Second broken-probe-as-negative of the
  day (see the `nak` note). And a test caught a real hole rather than a wrong
  expectation: `<podcast:funding url="…"/>` is **self-closing** when it has no label,
  arriving as `Empty` rather than `Start`, which the scanner ignored.
- **U4.5 H4 — the enrich slice (2026-08-19, Linux-verified).** `Sub.enrich` sits
  beside `Sub.harvest` and is passed through Rust opaquely (a typed struct only so
  serde cannot drop it — the failure that cost the guid stamps once). Rules, both
  from the direction doc and both tested: **feed always wins** (user values show only
  where the feed is silent) and **enrich is never overwritten** (a fetch replaces
  harvest wholesale; a user value the feed later states goes **dormant, not deleted**
  — hidden while carried, back if the feed stops). `podcastIdentity()` is the pure
  merge and reports `fromUser`, so the UI can mark hand-typed values (tooltip: "…
  (your note)"). **No editor yet** — this fixes the shape and merge so the editor is
  a screen, not a migration. Stations need no such slice: their `name`/`description`/
  `tags` are already first-class user fields and already win.
  **Gap found in H1's own DoD claim while verifying:** expanding a row was gated on a
  *fetched* feed, so the persisted identity was invisible precisely when it was all
  that remained (offline, or post-restore). Identity now renders from the store; only
  the episode list waits, and says so. Proven with the feed-cache stashed and no
  network: a stored sub rendered author/category/website/email from `podcasts.json`
  alone, a feed-silent sub rendered its `enrich` values marked as the user's, and a
  dormant enrich value (feed states one too) correctly did **not** show.
- **U4.5 H3 — export == persisted state (2026-08-19, Linux-verified). THE MINOR'S
  DEFINITION OF DONE.** The station export hand-listed fields, so H2's `harvest`
  would have been dropped on write and unreadable on read — the drift this minor
  exists to close, recreating itself two commits after being closed. Both writers now
  share `toExportStation` (one shape, cannot disagree), `parseStationHarvest` reads
  the slice back, and the app-level backup stops emitting `eventId` (a relay event id,
  meaningless on another machine). **The guard that makes it stick:** a test walks
  every key of a fully-populated persisted `Station` and fails if the export omits
  one — adding a stored field without exporting it now breaks a test instead of
  shipping a lossy backup. Verified against the real store: 10 stations + 10
  subscriptions (83 harvest fields) round-trip **identical**. Podcast export was
  already whole (it writes `Sub` objects directly) and is now covered by the same
  round-trip guard.
- **U4.5 H2 — station harvest persisted (2026-08-19, Linux-verified).** The ICY
  probe (`icyName`, `genre`, `bitrate`, `homepage`, `fmt`, `probedAt`) now lands on
  the local station via `set_station_harvest`, replacing the slice wholesale per
  probe and skipping the write when nothing changed. It was component state before,
  so homepage/genre evaporated on every quit. **Stations invert the podcast rule** —
  the user's typed name/description/bitrate always win, because `icy-name` is a
  banner while a podcast's harvest is the publisher describing their own show; the
  three-source merge is now a pure `stationIdentity()` with 6 tests. Verified live:
  tuning Fluid wrote all five fields (`"Fluid: Drown in the electronic sound…"`,
  genre `Hiphop Future Soul`, 128k, somafm.com, audio/mpeg) with user fields
  untouched. Relay-only stations have no local row to write to — reported, not
  silently dropped.
  **Diagnosis note:** an earlier "nothing persisted" read was *not* a bug — that
  build simply had never had a station tuned in it, and the probe only fires on
  tune-in. The silent `.catch(() => {})` on the probe made a failed probe and an
  un-run probe indistinguishable; every outcome now logs (probe failed / advertises
  nothing / no local row / store failed).
- **U4.5 H1 — podcast harvest persisted (2026-08-19, Linux-verified).** The Tier-A
  identity slice (author, categories, language, copyright, website, ownerEmail,
  `image` stored-not-rendered, feed blurb, `fetchedAt`) now lives on each `Sub` in
  `podcasts.json`, not only in the feed-cache — the cache is excluded from backups and
  version-invalidated, while the subscription store is what export and cross-machine
  carry actually use. Replaced wholesale per fetch (feed always wins); absent fields
  stay **absent** so "not stated" ≠ "stated blank"; the reconcile ignores `fetchedAt`
  when diffing, so an unchanged feed does not rewrite the store on every launch.
  **10/10 subs carry 6–7 fields.**
  **The bug persistence exposed:** `ownerEmail` came back empty on *every* feed
  because `feed-rs` surfaces neither `<itunes:owner><itunes:email>` nor
  `<managingEditor>` — so U4's Tier-A harvest has never captured one and its chip
  could never have rendered. The guid scanner became `extract_channel_extras`,
  returning guid + owner email in **one pass**, stripping the RSS `address (Name)`
  form and ignoring item-level addresses. Now **6/10** (the other 4 state none —
  audited against raw XML). `FEED_CACHE_VERSION` 2 → 3 accordingly: the second time
  that counter has earned itself, since cached bodies would otherwise 304 forever
  with the old parse. *Verification note: a version bump makes the store a moving
  target for ~a minute as all feeds re-fetch sequentially — read it twice.*
- **Dev/release store isolation — DONE 2026-08-19.** `app_data_dir()` and the
  now-playing bridge dir both gain a `-dev` sibling under `cfg(debug_assertions)`, so
  `tauri dev` no longer reads or writes installed state. Until now only the *keyring*
  was split (`ntune-dev`) while `app_data_dir()` was shared — meaning every `make dev`
  run this project has ever done was writing the real `stations.json` /
  `podcasts.json` / `settings.json`, with the same whole-file-rewrite and
  serde-field-drop exposure as the two-instance hazard. The bridge is split for a
  different reason: **RadioBar reads the release path**, so a dev run must not
  overwrite what it displays; the tray consumer now calls the producer's resolver
  (`nowplaying_dir`) instead of restating the path in a comment-synced copy.
  Release paths are byte-identical, so **no user data moves**. Verified live: a
  `make dev` run created `uk.fizx.ntune-dev/` (own seeded `stations.json` +
  `settings.json`) and `radio-scan-dev/`, while the installed store kept its mtimes
  and all 10 subs / 7 guids; dev and installed then ran **side by side**, and a
  second *release* instance was still refused. 25 Rust tests (3 new, incl. that
  release paths are untouched).
- **`make install` now always runs `tauri build` (2026-08-19).** The binary used to
  be a *file* target, so anything that wrote `src-tauri/target/release/ntune` more
  recently than the sources made make skip the build entirely. A stray
  `cargo build --release` — which does **not** run Vite, so the frontend is never
  embedded — therefore got copied straight to `~/.local/bin` and the installed app
  failed on launch with **"Could not connect to localhost: Connection refused"**,
  because it fell back to the dev server. (This is the trap the root CLAUDE.md warns
  about: *release path is `tauri build`, never `cargo build --release`*. The Makefile
  now enforces it rather than trusting it.) `build` is unconditional; cargo and Vite
  do their own incremental work, so a no-op rebuild costs seconds.
  **Diagnosing this class:** `strings` is a bad probe — Tauri compresses embedded
  assets, and `devUrl` appears in the config even in a correct release build. The
  reliable check is functional: `<local_data_dir>/radio-scan/nowplaying.json` is
  rewritten seconds after launch **only if the React frontend actually boots**.
- **Tooling note: capture `nak` with command substitution.** Its output is lost when
  `timeout` kills it mid-write to a redirect or `tee`; an empty capture read as
  "resolves 0 shows" during the 2026-08-19 session and was briefly mistaken for a
  result. `S=$(timeout 25 nak req …)` is reliable.
- **Single-instance guard — FIXED 2026-08-19 (`tauri-plugin-single-instance`).**
  Two ntune processes had been running against one data dir (a pre-S0 `--tray`
  instance plus a leftover test run). Every durable store is a whole-file rewrite
  from an in-memory cache, so two processes clobber each other last-writer-wins — and
  an **older process** is worse than a race, since serde drops every field its
  structs predate: the pre-S0 instance's `PodcastSub` had no `guid`, leaving 8
  harvested guids one subscription write from gone. Nothing was lost, but the class
  had bitten twice (see the `latestAt` drop above), so it is now closed structurally
  rather than by remembering to quit stale apps. A second launch hands its argv to
  the callback and exits; `tray::reveal_main_window` (now shared with the tray's
  "Show ntune") brings the existing window forward, so double-clicking the launcher
  reads as "bring it to the front". Verified on Linux: a third launch exits 0
  immediately and the process count stays at one.
  **The guard is release-only**, because the follow-up below removed the reason to
  guard debug.
- **`show.v1` S3 — Podcasts-tab Follow UI, BUILT + preview-verified (2026-08-18).**
  Per-row **follow** control (publishes `show.v1`) → `following` chip once the event
  reads back off the relays; published state is never local state, so the chip
  reflects the relay, not the click. `mergeFollows` (pure, unit-tested) merges local
  subs with published follows **by guid first, then URL**, appending relay-only rows
  tagged `relay` — a show followed from another machine shows up here without this
  device ever subscribing. Unsubscribing a published row retracts the follow too,
  with the confirm dialog carrying three different wordings (local-only /
  published+local / relay-only). Both map decisions are in the code: **follow is
  explicit, import never publishes**, and `uniqueShowSlug` suffixes `-2` at publish
  time because the `d` tag IS the identity. **Bug caught in the preview:** the follow
  button was nested inside the row's expand `<button>` — invalid HTML that React
  refuses to hydrate; it is now a sibling in both views, verified `button button` = 0
  and no horizontal overflow. Verified with a temporary local stub (identity + two
  fake shows, reverted): all four row states render — followed-by-guid, two
  unfollowed, and a relay-only row. 45 TS + 22 Rust green. **Not exercised against a
  live relay** — that needs the signing key and is the operator's call.
- **`show.v1` S2 — read path + shared resolver, BUILT (2026-08-18).** `lib/show.ts`
  (parse/resolve for 31242, `i` → `guid`), and `hooks/useStations.ts` →
  `useFollows.ts` reading **31241 + 31242 + 5 on one subscription** (same author,
  same relays, same deletion stream — a second pool would duplicate every kind:5).
  The NIP-09 + replaceable rules are **extracted** to `lib/addressable.ts`, not
  copied: deletion voids only events at-or-before its timestamp (unfollow → refollow
  works) and addressable events replace rather than append. **Regression proof: the
  existing station tests pass through the extraction unchanged.** New show tests
  include the two cross-talk cases the shared subscription creates — a station
  deletion must not tombstone a show at the same `d`, and one mixed event stream must
  resolve both lists independently. 37 TS + 22 Rust green. App still consumes only
  `stations`; the Podcasts tab picks up `shows` in S3.
- **`show.v1` S1 — Rust write path, BUILT (2026-08-18).** `publish_show` (31242) +
  `unfollow_show`, per-kind `d` prefixes (`D_STATION_PREFIX` / `D_SHOW_PREFIX`), and
  the **inverse guard**: `publish_show` refuses a conclusively audio URL exactly as
  `publish_station` refuses a feed. A test asserts the two guards disagree on
  everything either is sure about — nothing may be refused by both, and only an
  inconclusive probe passes both. Tag building is a pure `show_tags` so the shape is
  testable without a key, and one test **rebuilds the contract fixture's own record
  and diffs it against what ntune emits** — the guard against schema/code drift.
  `guid` → `i: podcast:guid:<guid>`, never blank. 22 Rust + 30 TS green. TS wrappers
  (`publishShow`/`unfollowShow`) are in place; **no UI yet — S3.** Not yet exercised
  against a live relay: that needs the signing key and is the operator's call.
- **`show.v1` S0 — `<podcast:guid>` harvest, BUILT + Linux-verified (2026-08-18).**
  The prerequisite for the `i` tag (and for U4.5's podcast key). `feed-rs` 2.x has no
  extension map, so the guid is scanned out of the raw feed bytes with `quick-xml`
  (promoted from indirect dep), persisted as `Podcast.guid` → `Sub.guid`. Verified on
  the real 11-feed profile: **8/11 carry a guid, all 8 extracted**; the 3 blanks
  (podbean/Duck, BBC, acast) publish none — re-checked against the raw XML. Four
  values match guids read off the live feeds by `curl` before the code existed.
  **Two things the build map got wrong, corrected in the code:**
  - *"Bind the namespace URI, not the prefix"* would have dropped No Agenda, which
    binds `podcast:` to the namespace's **GitHub docs page** rather than the canonical
    URI. Rule is now: known podcast namespace **or** a literal `podcast:` prefix —
    with an `<item>`'s own `<guid>` still never mistaken for the channel's.
  - *The feed cache would have starved the extractor.* The 11 cached bodies predated
    the field; their ETags would have drawn 304s and returned the old parse forever.
    `CachedFeed` now carries `FEED_CACHE_VERSION` (entries without it read as v1) and
    validators are only replayed for a body the running build can read. Confirmed by
    the run: all 11 bodies re-fetched in full and now read `v: 2`. **This is a general
    rule for the store — a parse change must bump the version or it lands silently.**
- **`show.v1` (kind 31242) — open decision #10 SETTLED 2026-08-18.** Podcast follows
  now have a wire form: the feed-shaped sibling of `station.v1`, drafted at
  [`schema/show.v1.json`](schema/show.v1.json) with two fixtures. Addressable,
  per-publisher, `d = airplay:show:<slug>`, required `name` + `r` (the **feed** URL);
  31242 confirmed unused across the suite and contiguous with 31240/31241. Two
  decisions inside it: **identity is `i`, not `r`** — the feed's `<podcast:guid>`
  rides as a **NIP-73** `i` tag (`podcast:guid:<guid>`, `#i`-filterable) and is the
  preferred cross-user key, because a feed URL is demonstrably unstable (podbean
  served the byte-identical 4 MB document from two hostnames, which is why Duck
  showed in both tabs); it stays **optional** because only 4 of 6 sampled live feeds
  carry a guid. And **harvest is not wire** — U4.5's Tier-A identity stays local, the
  event publishes the *follow*, the feed stays the authority on itself. Fixtures cover
  both cases (Duck without a guid, No Agenda with a real one). **Not yet built:** the
  plumbing — mapped S0–S4 in
  [`docs/show-v1-plumbing-buildmap-2026-08-18.md`](docs/show-v1-plumbing-buildmap-2026-08-18.md)
  (guid extraction → Rust write path → shared addressable resolver → Podcasts-tab
  Follow → verification), a separate slice that need not gate the 0.2.0 tag. **S0 is
  a hard prerequisite shared with U4.5:** `feed-rs` 2.4 exposes **no extension map**,
  so `<podcast:guid>` — the `i` tag the contract calls its preferred cross-user key —
  is unreachable through the current parser and needs extracting from the raw bytes
  (`quick-xml` is already in `Cargo.lock` via feed-rs). Two decisions taken in the
  map: **Follow is explicit and import never publishes** (an OPML import of 31 feeds
  would otherwise fire 31 publishes at hosts already seen rate-limiting a read
  sweep), and **slug collisions take a `-2` suffix** resolved at publish time.
- **NIP-09 deletion is id-based on some relays (2026-08-18).** Fallout from the
  above: `relay.fizx.uk` **accepted** every station deletion and kept serving the
  targets anyway (7 of 7 still on the wire after deletion), while nos.lol and primal
  dropped theirs. The deletions tagged only the addressable `a` coordinate, and
  several implementations honour NIP-09 **by event id**. `unfollow_station` now adds
  an `e` tag with the id of the event being deleted (`Station.eventId`, carried from
  the relay copy through App's local-wins dedupe so the common case isn't `a`-only);
  a local-only row has no published event and stays `a`-only. ntune was never
  affected — `resolveStations` filters deletions client-side — but any other client
  reading that relay was. Unit-tested both sides (Rust `deletion_tags`, TS
  `parseStation`/`resolveStations`). **Measured on macOS 2026-08-18 — the same two
  events, as a controlled A/B:** the `a`-only deletes of 10:53 left `7116cb48…` and
  `4b10cd45…` still served by `relay.fizx.uk` (nos.lol + primal had dropped theirs);
  a `kind:5` naming both `e` ids removed them from all three. `relay.fizx.uk`
  therefore honours NIP-09 **by id** and ignores it **by address** — this fix's
  premise, confirmed on the hub that motivated it rather than inferred from the
  discrepancy. **Not retroactive**, and there is a gap the app cannot close today:
  once a deletion is issued, `resolveStations` hides the row, so no ✕ remains to
  re-issue from — and `publish_station`'s non-audio refusal (`805ef10`) blocks
  re-adding a feed row to obtain a fresh event. The only exit is out-of-band
  (`nak event -k 5 -e <id> --prompt-sec`, which is how these two were cleared). A
  *republish-tombstone* affordance — or a deletion audit that re-reads the wire and
  re-issues what a relay is still serving — would close it.
- **Feed body cache — U4.5 slice 4, BUILT + Linux-verified (2026-08-18).** The
  Podcasts tab used to refetch all eleven feeds from a blank slate on every launch —
  its cache was a module-level object in `PodcastTab.tsx` that died with the process.
  Parsed bodies now persist to `<app_data_dir>/feed-cache/`, **one file per feed**
  (`{url, fetchedAt, etag?, lastModified?, podcast}`); the tab paints from disk via a
  batched `cached_podcasts` read, then refreshes in the background. **Freshness is
  the server's call, not a TTL** — stored validators replay as a conditional GET, so
  an unchanged feed costs a 304 with no body and no reparse. Verified on the real
  11-feed profile: **1.88 MB, 5,926 episodes, ETag on 11/11** (Last-Modified on 9/11),
  and a live curl check had podbean / fountain.fm / nashownotes answering 304 (the
  BBC CDN answers 200 regardless — degrades to today's behaviour). Bodies are pruned
  when a feed is unsubscribed, and are **not exported** — a cache, not state. The
  refresh pass tracks *fetched this session* rather than *present in cache*, or a
  disk-primed row would look fetched and never see today's episodes. Design +
  decisions recorded in the v0.2.0 direction doc § the feed body cache.
- **`podcast:guid` dedupes the local library too (macOS, 2026-08-18).** A 29-sub
  profile carries **four duplicate pairs** — the same show subscribed twice under
  different hosts — and all 29 URLs are distinct, so URL-keyed dedupe sees nothing:
  Bitcoin And (podhome = soundcloud), Once Bitten! and TFTC (fountain.fm = anchor.fm),
  Closed Network Privacy (yellowball = anchor.fm). **All four pairs share an identical
  `<podcast:guid>`**, and two of them differ in *title* across the pair
  ("Bitcoin And . . ." vs "Bitcoin And | Bitcoin & Economic News"), so neither URL nor
  title collapses them — guid is the only key that does. This gives U4.5's Tier-A
  `podcast:guid` harvest a second job beyond wire identity: **collapsing duplicates in
  the Podcasts tab** — and S0 (`553feb1`) has since built the extractor, so the value
  is already on `Sub.guid`; only the collapsing is missing. **`mergeFollows` does not
  do it:** it maps `subs` 1:1, using the guid to match a sub to a *published show*,
  never to fold two subs together. So a duplicate pair still renders twice — and once
  either is followed, both rows match the same `Show` via `byGuid` and both render as
  `following` for a single published follow. Recorded under decision #10 in the
  direction doc.
- **Next — v0.2.0 "make it durable" *minor* (U4.5), the headline still unbuilt.**
  The subscription/prefs stores above are the **precursor**; U4.5 is persisting the
  *harvested* slice into them — `station.v1` description + ICY-on-tune-in for
  stations, Tier-A identity (author, categories, language, copyright, website,
  email, `podcast:guid`, `podcast:funding`, top `podcast:value` `lnaddress`,
  `image` URL stored-not-rendered) for podcasts. Harvest and user **enrich** stay
  separate slices — re-fetch overwrites harvest freely, **feed always wins**, enrich
  is gap-fill-only. Keyed `podcast:guid`‖feed-url (podcasts), slug+url (stations) —
  a compatibility contract for import/export from here on. The driving symptom is
  **export serializer-drift**; the definition of done is **export == persisted
  state**. Direction (incl. the open decisions to settle inside the minor):
  [`docs/radio-scan-v0.2.0-direction-2026-08-10.md`](docs/radio-scan-v0.2.0-direction-2026-08-10.md).

- **Decision #11 steps 1–3 — macOS pass: cross-device convergence MEASURED
  (2026-08-20).** The property the whole decision exists for, checked between two
  independently-maintained stores rather than asserted: Linux published 9 stations
  and 10 shows, and this machine's local rows derive **the same addresses** for
  everything the two have in common — **4 of 6 stations, 9 of 10 shows**.
  The station that proves it is `f6916d13d3603b75`: typed here as *"SomaFM — Indie
  Pop Rocks"* and there as *"Indie Pop Rocks!"*, **two names, one address**. Under the
  old scheme those were two events for one stream — the same bug that produced
  `acid-jazz` / `aj` / `acid-j` / `acid-jazz-2`. Duck and Once Bitten! converge too,
  subscribed separately on each machine. All published `d` values are 16 lowercase
  hex, so the self-describing property that made `dfmt` unnecessary holds on the wire.
  Suites green here: **45 Rust + 138 TS**.
  *Method note:* the first run of this check reported everything as unmatched because
  `timeout … nak > file` produced empty captures — exactly the gotcha `4327ddd`
  recorded on Linux, hit on a second machine within a day. Command substitution is
  the workaround; a silent empty capture reads as a clean negative result, which is
  the dangerous shape.
- **Episodic logging hands off to Linux (2026-08-19).** `otw_playlist.py` and
  `duck_playlist.py` are vendored into `episodic/` (`0af91ce`) with the
  `--data-dir` convention and a systemd-timer installer, so the two feed-parsed
  shows can run anywhere instead of only on one Mac under launchd. **Linux owns
  them after the handoff; Acid Jazz stays on macOS** — the episodic pair derive
  everything from a public feed, so two hosts means two independently-built copies
  of the same rows, while the live logger needs uptime rather than a schedule (a
  VPS is the eventual answer there, not either desktop). The archives are copied,
  merged, not re-derived: the Blogger feed serves **1,666 episodes back to
  1980-02-28** against the Mac's 1,257 back to 1984-10-14, so `--all` is the *more*
  complete source (412 episodes never reached the Mac) while the Mac holds 3 posts
  the feed no longer serves — copy then backfill yields the union. Duck is 9,214
  rows / 698 episodes back to 2012. Staged with a checksum manifest in Proton
  (`ntune/radio-scan-logs/`, `~/Documents/ntune/radio-scan-logs/` on Linux).
  Procedure, verification counts and the one failure mode that matters — a dedupe
  key mismatch reading the whole archive as new — are in
  [`docs/episodic-linux-handoff-2026-08-19.md`](docs/episodic-linux-handoff-2026-08-19.md).

- **Decision #11 step 3 — publish-all / follow-all VERIFIED from macOS (2026-08-20).**
  The whole decision, exercised end to end across two devices. Both buttons offered
  **exactly the predicted counts** — `publish all (2)` and `follow all (16)`, computed
  beforehand from this store against the 9 stations + 10 shows Linux had published —
  which is itself the test of `2c0054c`'s canonical matching: 4 stations and 9 shows
  were recognised as already-published despite Linux having typed different names.
  After pressing: **11 stations and 26 shows on all three relays**, every address
  16-hex, 12 shows carrying an `i` guid tag, all 25 local subs represented, and the
  one address that is not mine is Linux's show I never subscribed to.
  **The open sub-question holds in practice:** a device did not re-assert what it
  received. Linux's four stations kept their event ids *and their names* — the wire
  still says `Indie Pop Rocks!`, not this machine's `SomaFM — Indie Pop Rocks`, for
  the address both devices derive — and Linux's `Bitcoin And` is still `f25af65c8d7c`.
  **18 items × 3 relays = 54 writes, zero failures**, paced at 400 ms by
  `publishSequentially`; the rate-limiting that motivated the pacing did not bite even
  with 16 podcast follows in one burst.
  *Caveat:* this ran with the VPN up, since the direct path is still blocked by the
  direct network path still fails for reasons not established — see the note below.
  The publish path is unaffected by it (Rust, which was never blocked).
- **macOS reads nothing from the relays — UNRESOLVED, VPN restores it (2026-08-20).**
  Steps 2–3 verification stalled: `publish all (6)` / `follow all (25)` with the header
  reading `saved on this device` — `relayStations` empty, everything looking
  unpublished. **Connecting a VPN restored it immediately** and the counts became the
  predicted `(2)` / `(16)`; the direct path still fails and **the cause is not
  established.** Measured and ruled out, so they need no re-testing: the relays (all
  three served the events under the app's exact filter), the resolver (**3,578-event
  stream → 9 stations, 10 shows in 10 ms**; incremental path 487 ms), `nostr-tools`
  (3,580 events, first at ~1 s), the same frontend in Chrome (`0 local · +9
  station.v1`), WebKit itself (Safari opened all four test relays), and
  ATS/entitlements. Rust networking was never affected — only the webview's reads.
  **A wrong measurement cost most of the hour:** `lsof` on ntune's own pid shows no
  sockets because WKWebView's belong to `com.apple.WebKit.Networking`; checking the
  helper showed the app *was* connected to `relay.fizx.uk` while displaying nothing,
  which is the real shape of the problem. A per-connection filter (this machine runs
  Little Snitch and LuLu) plus `install.sh`'s ad-hoc re-signing would fit "worked last
  night, stopped tonight", but **no filter was observed denying anything** — LuLu holds
  no rule at all and Little Snitch's log needs `sudo` and was never read. Hypothesis,
  not answer. Evidence, the correct `lsof` incantation, and the two checks that would
  settle it are in
  [`docs/macos-webview-relay-reads-2026-08-20.md`](docs/macos-webview-relay-reads-2026-08-20.md).
- **The read subscription is wasteful regardless (found 2026-08-20).** `useFollows`
  asks for every `kind:5` the author ever wrote: **3,559 deletions** — nearly all
  ndisc's release retractions, tagged `k=31237` — for **19** useful events, and it
  recomputes on each one. It is fast enough today (487 ms for the whole incremental
  pass) so this is not a bug report, but it grows with the suite's history, not with
  ntune's. Two-phase (`31241`+`31242` first, then `kind:5` filtered by `#a` on the
  resolved addresses) would bound it; ntune's own deletions carry no `k` tag, which
  is why `#k` filtering cannot work yet.

- **Podcast `refresh` button — macOS pass, VERIFIED (2026-08-20).** Pressed against a
  cache last read at launch (~1h 50m stale): **25 of 25 entries re-confirmed, none
  left stale, 15 s for the whole list** — the conditional GET doing its job, since a
  full re-download of these bodies is tens of megabytes. UI reported `refreshed 26, no
  failures`. One feed genuinely changed (spreaker +1 episode), every other episode
  count identical, so a refresh does not thin a parse. Cache and subscriptions ended
  **1:1 with no orphans**: the 26th was a body for a feed no longer subscribed, pruned
  during the run, which is why the UI counted 26 and the disk holds 25.
  *Method note:* the first comparison flagged that feed as **278 episodes → 0** and
  looked exactly like data loss. It was `dict.get(url, 0)` reading *absent from cache*
  as *emptied* — the same false-negative shape as an empty relay capture. Absence and
  zero are not the same measurement; check which one you have before reporting a
  regression.

- **Podcast `refresh` button — Linux pass, VERIFIED (2026-08-21). `Needs-verify` on
  `c5fa8e7` is now closed on both platforms.** Release binary installed to
  `~/.local/bin` and driven through XTEST, so the button was really pressed. Two runs.
  **Run 1, the real profile** (10 subscribed · 26 published): the counter ticked
  `refreshing 1/26… → 26/26…` monotonically over **~21 s** (~0.8 s/feed, never two in
  flight — the sequential pacing that the fountain.fm/anchor.fm rate limits on
  2026-08-19 bought), settled on **`refreshed 26`**, and cleared back to the button
  after the 4 s timeout. On disk: **all 26 `feed-cache/` entries restamped**, and the
  `podcasts.json` diff was *only* `harvest.fetchedAt` on all 10 subs
  (`1787250263 → 1787250833`) — same restamp-on-304 semantics macOS measured, and
  nothing else in the store moved.
  **Run 2, the failing-feed half**, which macOS did not cover: the same installed
  binary against a throwaway `XDG_DATA_HOME` profile — two live feeds plus a
  deliberate `https://feeds.nope.invalid.fizx.uk/missing.xml`. `refreshing 1/27… →
  27/27…`, then **`refreshed 26, 1 failed`**. The run did not abort on the failure,
  both halves were reported, and `describeOutcome`'s new verb read correctly in the
  mixed wording. A scratch profile rather than a poisoned real store, because the
  point was to break one feed, not the catalogue.
  *Nit, not a defect:* the tooltip says "Re-read every **subscribed** feed", but
  `refreshAll` maps over `rows`, so it re-reads relay-followed rows too — 26 rows
  against 10 subscriptions here (and macOS's "refreshed 26" against 25 subs is the
  same arithmetic). Refreshing what is on screen is the defensible behaviour; it is
  the wording that undersells it.

- **The sync line + state column — macOS pass, VERIFIED (2026-08-22). Closes
  `Needs-verify: macos` on all seven code commits of the parity wave
  (`20efad4` … `cdca394`).** Release bundle built here (aarch64, v0.1.1-beta.4)
  and installed to `/Applications`. 159/159 tests green, `tsc && vite build`
  clean. Launching the new build touched **only** `harvest.fetchedAt` / `latestAt`
  on podcasts and the ICY `harvest.*` slice on stations — 25 subs and 6 stations
  in, 25 and 6 out, nothing added, nothing removed, no subscription rewritten.
  **The two lines, read off the running app:** `26 shows · 25 here · 24 published`
  with `add all (1)` + `follow all (2)`, and `11 stations · 6 here · 11 published`
  with `add all (5)` and no `publish all`. Both arithmetics close
  (`26 = 25+1 = 24+2`, `11 = 6+5 = 11+0`), and both machines independently report
  **24 published shows and 11 published stations** — Linux reads the same relay
  set as `11 stations · 9 here`, this box as `11 · 6 here`.
  *The line corrected the prediction rather than confirming it.* `b69645e`
  expected `25 shows · 25 here · 24 published` with `follow all (1)` — one
  subscription made here and never published. The truth is 26/25/24: **two** subs
  here were never published, **and** one published follow is not here at all. The
  guess assumed this device's 25 subs were a superset of the relays' 24; they
  overlap at 23. That is the line doing the job claimed for it — stating a
  different number from the assumption, and the new one being the true one.

- **Absence is not zero, in the UI this time — `0 published` when no relay
  answered (found 2026-08-22, NOT fixed).** The first launch of the new build
  read `25 shows · 25 here · 0 published` + `follow all (25)` and `6 stations ·
  6 here · 0 published` + `publish all (6)`. Nothing was wrong with the relays:
  `lsof` showed the process holding **zero** connections to any of the three
  relay IPs while `useFollows(ownerHex, true)` was unconditionally active. Cause:
  the four Keychain commands (`get_identity`, `generate_identity`,
  `import_identity`, `clear_identity`, `src-tauri/src/lib.rs:594-628`) are
  **sync**, so Tauri runs them on the main thread — the thread driving the
  WKWebView. A Keychain authorization prompt there freezes all JS, so the relay
  subscription never opened a socket. Audio kept playing because the stream is
  served by the Rust proxy on its own threads. Every other nsec-touching command
  (`publish_station`, `unfollow_station`, `publish_show`, `unfollow_show`) is
  already `async`. Relaunching and answering the prompt gave the correct counts
  above, first try.
  *Two things worth separating.* The prompt itself is a development artifact —
  the app is unsigned, so each rebuild gets a fresh ad-hoc signature and the
  Keychain item's ACL no longer recognises the caller. Not worth chasing. The
  UI consequence is not dev-only: `syncCounts` cannot distinguish "the relays
  serve nothing" from "no relay has answered", `useFollows` clears `loading`
  after 5 s *specifically* so a silent relay does not hang the spinner
  (`useFollows.ts:111`), and neither tab's status line consumes it anyway. Any
  locked login keychain in a shipped build renders the same screen: a confident
  `0 published` beside a button offering to publish 31 events. Suggested, in
  order of size — gate the two bulk buttons on at least one relay having
  answered; make the four Keychain commands `async`. The same absence-vs-zero
  reading that produced a false regression report on the relay capture, now in
  the surface a user acts on.
  **Method correction (2026-08-22, same day).** The `lsof` evidence quoted above
  is void, and the claim it supported is now hypothesis rather than measurement.
  Relay sockets are held by **`com.apple.WebKit.Networking`**, the XPC service
  WKWebView does its networking in — NOT by the `ntune` process. The snapshot was
  scoped `lsof -p <ntune pid>`, which by construction can never show one. What it
  actually counted was the Rust-side feed prefetch over reqwest, which is why it
  appeared to flap 0→1→2→0. Measured correctly — poll the relay IPs across all
  processes and name the holder — a healthy launch holds **3 relay sockets,
  steady from 02s**, while `ntune` itself holds none.
  What survives unchanged is the symptom, which never depended on `lsof`: the UI
  read `0 published` on both tabs while the relays demonstrably served 24 follows
  and 11 stations, and corrected on the very next launch. What is NOT established
  is the mechanism — that a synchronous Keychain command froze the WKWebView. It
  is well-founded on Tauri's threading model (a sync command runs on the main
  thread) and the fix is justified on that basis, but the matched control has not
  been run: the UNFIXED binary under an unanswered prompt, measured with the
  corrected harness. Two ways to get it, neither yet done — rebuild an unfixed
  binary (a fresh ad-hoc signature re-triggers the prompt by construction), or
  `security lock-keychain login.keychain` against the shipped one, which is the
  shipped-build failure mode this is claimed to matter for.
  *Two bad measurements in one day, both the shape this file already records —
  hashing PNGs that ImageMagick restamped, `dict.get(url, 0)` reading absent as
  emptied. Check that the thing being counted is the thing being claimed, before
  the count is quoted at anyone.*

- **Bulk publish exercised for the first time, on either machine — VERIFIED
  (2026-08-22).** `cdca394` recorded `publish all` / `follow all` as never having
  been pressed in anger: the Linux profile had nothing unpublished to press them
  with. This one did. From `26 shows · 25 here · 24 published` + `add all (1)` +
  `follow all (2)`: **`follow all` published two `show.v1` events** (sequential,
  400 ms apart, then a relay re-read rather than trusting the click), taking
  published 24 → 26; **`add all (1)` pulled the remaining relay-only follow onto
  this device**, taking here 25 → 26. Result: **`26 shows · 26 here · 26
  published ✓ in sync`**, both gaps closed. Disk agrees with the screen —
  `podcasts.json` went 25 → 26 subscriptions, the addition being *Global News
  Podcast*, with nothing removed and no existing sub rewritten. `in sync` here
  means what the tooltip scopes it to: everything on THIS device is published and
  everything published is here. It says nothing about the other machine, which is
  in sync when it says so itself.
  Worth noting what was NOT needed: no confirm on `add all` (local, publishes
  nothing, undone per row by ✕), a confirm on `follow all` (public act). The line
  `b69645e` drew between the two held up in use.

- **The relay-answered gate was live for it, in the scenario it was built for.**
  `follow all` renders only when a relay has answered (`8c66b56`), so the two
  events could not have gone out against a silent read — the exact failure mode
  that put a `follow all (25)` button on screen that morning. Three relay sockets
  were connected and the app was 1m50s old when the button was pressed. The
  safeguard's first real outing was the one press that would have been dangerous
  without it.

- **Stations `add all` on the real profile — VERIFIED (2026-08-22).** From
  `11 stations · 6 here · 11 published` + `add all (5)`, one press took the local
  store 6 → 11 and the line to **`11 stations · 11 here · 11 published ✓ in
  sync`**. Disk agrees: the five adopted rows are written with exactly the
  persisted fields (`slug`, `name`, `url`, `fmt`, `bitrate`, `tags`,
  `description`) and no `d` / `eventId` — correct, since those identify a relay
  event rather than a station and mean nothing on another machine. No relay
  writes: adopting publishes nothing. Both tabs on this device are now in sync,
  which is the first time either machine has said so about a real profile.
  *Confirmed in use, not by reading:* adopted stations arrive **prepended** —
  top of the list, in reverse order of adoption — because `adoptStation` puts the
  saved row at the head of `localStations`. Cosmetic, and the same family as the
  reordering `20efad4` fixed on the Podcasts list. Worth landing in place rather
  than at the top next time that file is open.

- **A heartbeat for the relay read, and a bug in `answered` (2026-08-22).** The
  root cause behind the morning's `0 published` was never the keychain: a
  subscription is not a standing guarantee, and a window left open drifts toward
  silence. Measured baseline — after **10h33m, two of three relay sockets had
  died** with nothing reconnecting them (`subscribeMany` was passed no
  `onclose`, though nostr-tools offers one). `useFollows` now re-ASKS rather than
  reconnects: the existing additive `refetchRef` querySync path folds into the
  same map the subscription writes and never blanks the list, and `pool.querySync`
  reaches relays through `ensureRelay`, which reopens a closed one. Three
  triggers — a 5-minute interval, `visibilitychange` → visible, and `online` —
  because the interval alone is the worst of them: a lid opened after hours
  should not wait out the rest of a timer before telling the truth. `onclose` now
  logs rather than dying quietly; the lists keep what they hold rather than
  blanking, since the last thing read is still the last thing known.
  **Bug fixed in the same pass, introduced by the gate itself.** `answered` was
  being set on every `querySync` resolution — but querySync resolves with `[]` on
  its `maxWait` whether every relay said "nothing" or *none of them connected*.
  Resolution is not a reply. It now takes an actual event, and the subscription's
  own `oneose` remains the safe signal for a genuine empty, since that fires only
  when relays really EOSE. Left unfixed, the gate would have re-armed the publish
  buttons against exactly the silent read it was built to catch.
  *Measurement note, third of the day.* Counting relay sockets by IP across all
  processes is wrong twice over: `104.26.x` / `172.67.x` are Cloudflare, shared
  with everything else the machine talks to, and **primal connects over IPv6**
  (`2606:4700:20::…`), which an IPv4 address list misses entirely. Count what
  ntune's OWN `com.apple.WebKit.Networking` instance holds on 443 — 3
  connections, one per relay, on a healthy launch.

- **FOR THE LINUX SESSION — overnight relay-decay run, agreed 2026-08-22 evening.**
  Both machines are being left running overnight with ntune open, deliberately on
  DIFFERENT builds, to settle whether the heartbeat in `122b1ef` actually recovers
  a read that has gone silent. This is the one question neither side can answer
  alone, and the window is tonight.
  **Read this file, but do not rebuild.** `git fetch` and reading are harmless —
  they do not touch the running binary, and this note is only reachable that way.
  What destroys the control is rebuilding, reinstalling, or restarting ntune. The
  Linux box holding the pre-heartbeat build IS the control; macOS is running the
  treatment. Rebuild after the reading, not before.
  **Do not touch the ntune WINDOW before measuring, either** — raising or focusing
  it fires `visibilitychange`, which on the treatment build triggers a beat. Take
  the socket trace first, read the status lines second.
  **In the morning, from the still-running app, record:**
  1. The two status lines verbatim, and whether `✓ in sync` is still shown. macOS
     went to bed on `26 shows · 26 here · 26 published ✓ in sync` and
     `11 stations · 11 here · 11 published ✓ in sync`.
  2. `ps -o lstart=,etime=` for the ntune process — the reading is worthless
     without knowing how long it actually ran.
  3. **The relay socket count, attributed to the WEBVIEW'S NETWORK PROCESS, not
     to ntune.** On macOS that is this app's own
     `com.apple.WebKit.Networking` instance; on Linux it is the WebKitGTK network
     process. `lsof -p <ntune pid>` can never see a relay socket — it returns the
     Rust/reqwest side instead. Do not count by relay IP either: `104.26.x` /
     `172.67.x` are Cloudflare and shared with everything else on the machine, and
     **primal answers over IPv6**, which an IPv4 address list misses outright.
     **Do not take ONE sample.** Watch for 7 minutes at 10 s granularity — this is
     the measurement that matters and a snapshot cannot make it. On the treatment
     build a healthy app sits at **0 sockets and bursts to 3 every 5 minutes**,
     because the heartbeat re-asks rather than holding a connection; sampled once,
     a working heartbeat looks like a dead app. On the control build there is no
     heartbeat, so the trace should be flat at whatever survived the night.
  **macOS result, in hand 2026-08-23 06:47 (+07) — the treatment WORKS.** After
  10h28m every relay socket was gone, and the 7-minute trace caught two beats,
  **4m52s apart**, each reconnecting all three relays through `ensureRelay` and
  releasing them again:
  `06:40:56→06:42:36 n=0` · `06:42:46 n=3` · `06:42:57 n=3` · `06:43:07→06:47:28
  n=0` · `06:47:38 n=1` · `06:47:48 n=3`. Predicted in advance, arrived on
  schedule.
  **Control result (Linux, 2026-08-23) — first half confirmed, second half was a
  BAD PREDICTION.** 9h38m uptime, 42 samples flat at **n=1**, zero variance, no
  bursts: no heartbeat, exactly as predicted, against a 3/3 baseline at 4 minutes
  uptime. Decay was partial where macOS's was total — `relay.fizx.uk` survived
  and was genuinely live (1.79 MB received, last activity 4.6 min before
  sampling), so two of three died there against three of three here.
  The `0 published` half never had a chance of reproducing, and not because of
  the partial decay. **Socket death does not blank the lists.** `setStations([])`
  / `setShows([])` appear in exactly ONE place, the top of the effect, in both
  builds — so events read at startup survive every relay dying, and the line goes
  on reporting them. Even at 0/3 sockets the control would have said
  `26 published`. Reaching `0 published` requires blank-THEN-resubscribe-into-
  silence, i.e. the `ownerHex` swap of `8c66b56`. The prediction was
  unfalsifiable as written; the mechanism it was meant to test is confirmed by
  why it failed.
  Control line, verbatim: `26 shows · 24 here · 26 published` + `add all (2)`, no
  `✓ in sync`, no `relays quiet`, no `follow all (N)`.
  **Cross-machine confirmation, unplanned and the best result of the run:** that
  `add all (2)` is precisely the two follows macOS published last night with
  `follow all (2)`. Linux went to bed on `24 shows · 24 here · 24 published ✓ in
  sync` and woke reading 26 published against 24 held. The device-to-device loop
  the whole feature exists for is demonstrated end to end, by two machines that
  were not coordinating.
  **Method note, now measured rather than asserted:** ntune's own pid held **0**
  sockets on Linux too. Anyone reading `lsof -p <ntune pid>` would have concluded
  the app had no relay connections at all, on a box where one was live and
  carrying 1.79 MB.

- **`relay.primal.net` may not RETAIN our kinds — suite may be on two relays, not
  three (found 2026-08-23, unconfirmed from macOS).** Linux measured primal
  serving **2 shows and 0 stations** over four consecutive attempts — not
  flakiness. It held 9 stations / 10 shows on 2026-08-20, and macOS reads 26 / 11
  across the set. So this is retention decay, not write rejection: primal accepts
  the events and prunes them later.
  That failure mode is worse than refusal. A relay that rejects a write tells you
  at publish time; one that accepts and silently forgets leaves a publish looking
  successful and a third of the redundancy imaginary. It also reframes last
  night's total decay on macOS: losing "three relays" was really losing two that
  matter plus one that had already forgotten us.
  Not yet confirmed from this side — macOS cannot query relays headlessly (node
  WebSockets are blocked by the local filters). Next step is a second reading from
  Linux, then a decision on whether primal earns its place in `lib/relays.ts` or
  should be replaced with a relay that keeps addressable events.
  **Caution on the control box.** That build has no relay-answered gate. If it
  does go silent overnight it will offer `follow all (N)` / `publish all (N)`
  against a read of nothing — the exact trap `8c66b56` closes. Record the button,
  do not press it.

## Outstanding
- **Not yet built:** L2 bridge (write `airplay.json` into the shared suite dir +
  reconcile heard tracks vs ndisc's catalogue) and the Nostr publisher/poller.
  The suite-level UI is now **underway** — ntune (§6) is at U0–U4a + the durable-
  store wave, with U4.5/v0.2.0 next; RadioBar (§5)
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
