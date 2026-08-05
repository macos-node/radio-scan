# Changelog — ntune

radio-scan's L4 desktop tuner/player. Notable changes per release. Dates are the
tag date; unreleased work sits under the top heading until tagged.

## 0.1.1-beta.1 — unreleased

The listening surface grows from radio-only to **radio + podcasts**, with live
track info. Verified on Linux; macOS verification of U4a in progress.

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
