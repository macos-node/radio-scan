# Changelog — ntune

radio-scan's L4 desktop tuner/player. Notable changes per release. Dates are the
tag date; unreleased work sits under the top heading until tagged.

## 0.2.0 — unreleased

Harvested station & podcast metadata becomes **durable state** — export reflects
exactly what's stored, and identity survives a restart. The "make it durable"
minor. Direction: [`../../docs/radio-scan-v0.2.0-direction-2026-08-10.md`](../../docs/radio-scan-v0.2.0-direction-2026-08-10.md).

### Planned
- **Metadata persistence (U4.5).** Harvested station (`station.v1` description +
  ICY-on-tune-in) and podcast (Tier-A identity: author, categories, language,
  copyright, website, email, `podcast:guid`, `podcast:funding`, top
  `podcast:value` `lnaddress`, `image` URL) fields persist to the local store.
  Harvest and user **enrich** stay separate slices — re-fetch overwrites harvest
  freely, **feed always wins**, enrichment is gap-fill-only and never clobbered.
  Keyed by `podcast:guid`‖feed-url (podcasts) and slug+url (stations) — a
  compatibility contract for import/export from here on. `image` URL stored, not
  yet rendered. **Export == persisted state**, closing the serializer-drift.

### Fixed
- **Podcast subscriptions now persist durably.** They moved off webview
  `localStorage` into a Rust-written `podcasts.json` (a synchronous `std::fs::write`
  next to `stations.json`), so a subscription lands on disk the instant it's added
  and survives **any** exit. WebView2 only flushed `localStorage` on a graceful
  window-close, so a crash / force-kill / OS sign-out / the tray "Quit" dropped
  every unflushed change — imported podcasts vanished on reopen while file-backed
  stations survived (Windows-visible; fragile on all platforms). Legacy
  `localStorage` subs migrate into the store on first launch. The subscription-list
  precursor to the U4.5 harvest-metadata persistence above. Diagnosis + evidence:
  [`docs/podcast-persistence-2026-08-11.md`](docs/podcast-persistence-2026-08-11.md).
  Verified macos 2026-08-12. Needs-verify: linux.
- **UI preferences now persist durably too.** Theme, volume, and the list/card view
  toggles moved off `localStorage` into a generic Rust settings store
  (`settings.json`, same synchronous write) — same durability gap, so they could
  reset on a non-graceful exit. `localStorage` stays a mirror (the `index.html`
  pre-paint theme read needs a synchronous source); the store is authoritative on
  load and migrates existing prefs on first launch. Verified macos 2026-08-12.
  Needs-verify: linux.
- **Fresh install no longer starts muted.** `loadVolume` let an unset value slip
  past its range guard (`Number(null) === 0`), so a first run defaulted to 0
  instead of the intended 0.9. An unset volume now returns 0.9.

## 0.1.1-beta.3 — unreleased

A cross-platform menubar/tray companion, and JSON import to round-trip the
station/podcast lists.

### Added
- **Menubar / tray companion (U6, opt-in `--tray`).** A small cross-platform tray
  now-playing surface — icon + menu with the live "Artist — Title", **Show ntune**,
  **♥ Favorite current track** (enabled only on a live track, running the same
  toggle as the in-window heart), and **Quit**. Off unless launched with `--tray`,
  so the default app is unchanged; the installed Linux desktop entry defaults to
  `--tray`, macOS is opt-in. Verified on macOS (WKWebView) and Linux (Ubuntu
  GNOME/X11). *GNOME needs the shell AppIndicator extension in addition to
  `libayatana-appindicator3-1` — see the README.*
- **JSON import (stations & podcasts).** Each list gets an **Import** button (native
  Open dialog) mirroring Export: merges into the local store / subscriptions,
  deduped (stations by slug+url, podcasts by url), imported entries first — safe to
  re-import. Round-trips the export shape and accepts minimal hand-made files
  (`[{name,url}]` — a missing station slug is derived, descriptive fields default).

## 0.1.1-beta.2 — 2026-08-05

Station/podcast list management: adds persist locally with no key, and both
lists are copyable + exportable.

### Added
- **Local station store.** Added stations now save to a **local, no-key store**
  (`stations.json` in the app-data dir — Linux `~/.local/share/uk.fizx.ntune`,
  macOS `~/Library/Application Support/uk.fizx.ntune`), so an add persists across
  restarts without a Nostr key. On a **fresh install** it's seeded from the built-in
  starter stations so the tuner is testable out of the box; every seed is an
  ordinary, **removable** row and does not come back once removed. When signed in,
  an add still also publishes a `station.v1` to the relays (best-effort — a relay
  failure never loses the local save), so the Nostr layer is now an optional
  overlay on top of the always-available local list.
- **Copy URL + JSON export (stations & podcasts).** Every station and podcast row
  gets a hover **copy** button (stream / feed URL → clipboard, brief ✓). Each list
  has an **Export** button that writes the list as pretty JSON via a native Save
  dialog (`ntune-stations.json` / `ntune-podcasts.json`). New Tauri plugins:
  `clipboard-manager` + `dialog`; the file is written by an `export_file` command.

## 0.1.1-beta.1 — 2026-08-05

The listening surface grows from radio-only to **radio + podcasts**, with live
track info. Verified on Linux and macOS.

### Added
- **Now-playing (U3).** The player bar shows the live **♪ Artist — Title**,
  parsed from the stream's ICY metadata by the loopback proxy (decode ladder
  UTF-8 → Windows-1251 → Latin-1). Updates on every track change. *Currently
  `http://` (proxied) stations only.*
- **Podcasts tab (U4a).** A **Stations | Podcasts** switch. Subscribe to a
  podcast by RSS feed URL (persisted locally); episodes are fetched and parsed
  server-side (Rust `reqwest` + `feed-rs`) and played through the same player.
- **Episode playback.** Playback now models two source types — a **live station**
  (non-seekable, with ICY now-playing) and a **podcast episode** (seekable, with
  a seek bar and **resume across sessions**, keyed by enclosure URL).
- **Favorites (♥).** Like the current track — a ♥ in the player bar saves the
  now-playing (artist / title / station) to a **local curated favorites log**; a
  Favorites dialog lists and removes them. Local-first v1 (the kind:7-reaction-on-
  `airplay.v1` layer is a later step — see the menubar-companion direction).

### Fixed
- **Proxy follows HTTP redirects.** Podcast enclosures (and some radio mounts)
  almost always `30x` through a tracking/CDN; the proxy previously masked that as
  a `200` and the webview got an HTML redirect page instead of audio. Now
  `http→http` is followed internally and `http→https` is handed to the webview.
- **`audio/aacp` MIME, platform-split.** webkit2gtk (Linux) needs `audio/aac`;
  WKWebView (macOS) needs the legacy `audio/aacp` — remapped on Linux only.
- **Unfollow → re-follow.** A re-added station reappears (the station list now
  honours NIP-09 deletion timestamps rather than tombstoning the address).

### Known limitations
- Full **seek on `http` podcast enclosures** needs the proxy to forward
  `Content-Length` and honour `Range` (206). `https` feeds seek fully today.
  Tracked as the reqwest-proxy follow-up (also TLS upstreams + `https`
  now-playing).
- Now-playing is `http`-only (proxied streams).

## 0.1.0 — 2026-08-05

Initial ntune release — a Nostr-native internet-radio tuner.

### Added
- **Tuner (U0).** Tauri 2 + React shell; three themes (mono / fizx / upleb);
  tune and listen to internet-radio streams via a hidden `<audio>` element.
- **Station registry (U1).** The station list is the user's published
  `station.v1` (kind 31241) events, read off the relays (`relay.fizx.uk` +
  nos.lol + relay.primal.net), with a seed fallback.
- **Follow / publish (U2).** A signing key in the OS keychain (import / generate)
  lets you follow a station — publishing a `station.v1` — and unfollow (NIP-09
  delete). One npub per person, shared with the ndisc suite.
- **Mixed-content loopback proxy.** A packaged app's secure origin blocks plain
  `http://` media; a Rust loopback proxy relays `http://` streams so they play.
- **Packaging.** Ships `.deb` (Linux) + `.dmg` (macOS) via `ntune-release.yml`.
  (The `.AppImage` is deferred — its bundled GStreamer freezes on playback; see
  `docs/appimage-gstreamer-2026-08-04.md`.)
