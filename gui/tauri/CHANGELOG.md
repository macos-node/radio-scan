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

### Added
- **Podcasts sort by recency.** The Podcasts tab gets a **Recent | A–Z | Added**
  order switch beside the list/card toggle, defaulting to **Recent** — the feed
  that published most recently sits at the top. Each feed's newest-episode date is
  harvested on fetch and persisted on the sub (`latestAt`), so the order is already
  right on the first paint of the next launch rather than settling as the
  background prefetch trickles in; feeds with no known date keep their stored order
  at the bottom. The choice persists in the durable settings store
  (`ntune.podcastSort`). Ordering is display-only — the stored order is never
  rewritten, so **Added** always gets it back. (A first, small slice of the U4.5
  harvest-persistence above: harvested, re-derived on every fetch, feed always wins.)
  Persisting it needed the Rust `PodcastSub` struct to carry the field: serde drops
  unknown keys on the way in, so the first cut wrote a stamp the store silently
  discarded — the export serializer-drift U4.5 exists to close, met early.

### Added
- **`show.v1` write path (S1).** `publish_show` (kind 31242) and `unfollow_show`
  land in Rust: a follow carries `d`/`name`/`r` (the **feed** URL), the feed's
  `<podcast:guid>` as a NIP-73 `i` tag when it states one, topic `t` tags and `alt`;
  the unfollow reuses the station deletion's `a` + `e` tagging. `publish_show`
  refuses a URL that conclusively serves **audio**, the exact mirror of
  `publish_station` refusing a feed — between the two guards, `#r` stays honest per
  kind. No UI yet; the Follow control arrives with S3.
- **Follow a podcast on the relays (`show.v1` S3).** The Podcasts tab gains a
  per-show **follow** control that publishes a `show.v1`, and rows already published
  show a `following` chip instead. Follows read back off the relays are merged into
  the list **by guid first, then URL** — the two are not interchangeable, since
  podbean serves one feed from two hostnames — so a show followed on another machine
  appears here (tagged `relay`) even though this device never subscribed to it.
  Unsubscribing a published show now retracts the follow as well, and the confirm
  dialog says so, with different wording for a relay-only row. Following is
  **deliberately per-show and never automatic**: podcasts arrive in bulk from OPML,
  and auto-publishing an import would fire dozens of events at hosts already seen
  rate-limiting a mere read sweep. Slugs are made unique with a `-2` suffix at
  publish time — `airplay:show:<slug>` is the addressable identity, so a collision
  would replace another show's event rather than create one. The control is hidden
  without a signing key.
- **`show.v1` read path (S2).** `lib/show.ts` parses kind 31242 into a `Show`
  (including the `podcast:guid` behind its NIP-73 `i` tag), and the relay hook now
  reads stations and shows over **one** subscription — they share an author, a relay
  set and the same kind:5 deletion stream, so a second pool would duplicate every
  delete for nothing. `useStations` becomes `useFollows`. The NIP-09 and
  replaceable-dedupe rules were **extracted** into `lib/addressable.ts` rather than
  copied: they encode that a deletion only voids events at or before its own
  timestamp (so unfollow → refollow works) and that an addressable event replaces
  rather than appends. The existing station tests pass through the extraction
  unchanged. Still no UI — S3.
- **Feeds' `<podcast:guid>` is now harvested (`show.v1` S0).** The Podcasting-2.0
  channel GUID — a show's identity independent of the URL serving it — is extracted
  on fetch and persisted on the subscription. It is what `show.v1` publishes as its
  NIP-73 `i` tag and what U4.5 keys the podcast harvest on, and it matters because a
  feed URL is demonstrably unstable: podbean serves the byte-identical document from
  two hostnames, which is how one show appeared in two places at once. `feed-rs`
  exposes no extension map, so this is read from the raw feed bytes with `quick-xml`
  (already an indirect dependency). Measured on an 11-feed profile: 8 carry a guid
  and all 8 were extracted; the 3 without one genuinely publish none (podbean, the
  BBC, acast). Accepts the element when its prefix resolves to a known podcast
  namespace **or** is literally `podcast` — No Agenda binds the prefix to the
  namespace's GitHub docs page, and a URI-only match would silently drop a guid the
  feed plainly states. An episode's `<guid>` is never mistaken for the show's.

### Fixed
- **The feed cache no longer starves a parser change.** Cache entries now record the
  parser generation that produced them (`FEED_CACHE_VERSION`). Conditional-GET
  validators are replayed only for a body the running build knows how to read, so a
  build that learns to extract a new field re-fetches in full instead of being handed
  its own stale parse forever. Without it the `podcast:guid` work above would have
  landed silently: eleven cached bodies would have answered 304 and kept their
  guid-less parse until each publisher happened to touch their feed. A stale-version
  entry still paints immediately; only its revalidation is skipped.
- **Unfollow now names the event as well as the address.** A station deletion
  tagged only the addressable `a` coordinate, and several relay implementations
  honour NIP-09 **by event id** — they accept an `a`-only deletion and go on
  serving the event. Measured on the suite's own hub 2026-08-18: `relay.fizx.uk`
  was still serving all 7 stations it had been told to delete, while nos.lol had
  dropped them. The kind:5 now carries an `e` tag with the id of the event being
  deleted whenever the row came from a relay (a local-only row has no published
  event to name, and stays `a`-only). ntune itself was never affected — it filters
  deletions client-side in `resolveStations` — but anything else reading that relay
  was.
- **A feed URL can no longer be published as a station.** `publish_station` now
  probes what the URL actually serves and refuses a conclusively non-audio
  content-type (`*/xml`, `rss`, `html`, `json`), pointing at the Podcasts tab
  instead. `station.v1` defines `r` as the stream mount and `#r` is the
  relay-filterable cross-user station identity, so a feed there publishes a
  non-tunable row into everyone's discovery space — which is how two podcast feeds
  reached the relays in 2026-08. Inconclusive probes (no content-type, or a failed
  request) still pass, so a genuine mount that advertises nothing is never blocked.
  The add dialog's matching warning stays **soft** — it guards the local store,
  which is yours to overrule; the publisher is hard, because that copy crosses the
  wire.
- **Podcast feeds no longer start from a blank slate on every launch.** Parsed feed
  bodies now persist to `<app_data_dir>/feed-cache/`, one file per feed, so opening
  the Podcasts tab paints the last known episodes and identity immediately instead
  of waiting on eleven refetches; the refresh then runs in the background. The
  session cache it replaces was a module-level object that died with the process.
  Freshness is the server's call rather than a TTL: each entry stores the ETag /
  Last-Modified it was served with and replays them as a conditional GET, so an
  unchanged feed answers **304** — no body, no reparse. Bodies for unsubscribed
  feeds are pruned on the next subscription write, and the cache is deliberately
  **not** exported (a body costs one fetch to rebuild; `export == persisted state`
  stays about the subscription + harvest slices). Design + decisions:
  [`../../docs/radio-scan-v0.2.0-direction-2026-08-10.md`](../../docs/radio-scan-v0.2.0-direction-2026-08-10.md)
  § the feed body cache.
- **Restoring an old export no longer wipes the podcast sort dates.** `mergeSubs`
  is incoming-wins, so importing a backup written before `latestAt` existed — or an
  OPML file, which has nowhere to carry it — reset every feed's newest-episode date
  and flattened the **Recent** order until each feed refetched. `latestAt` is
  harvest, not user data, so an incoming entry that lacks it now inherits the stamp
  already on the sub: a fetch still overwrites it freely (feed always wins), an
  import only gap-fills.
- **Removing a podcast or station now asks first.** The hover-✕ on a row/card
  removed the subscription outright, with no undo — and it sits exactly where the
  pointer already is, so a stray click silently dropped a feed. Both lists now open
  a confirm dialog naming the item and its URL; focus lands on **Cancel**, and
  Escape or the backdrop dismisses. The station dialog also says when removal will
  publish a Nostr `kind:5` unfollow (i.e. when signed in), since that leaves the
  published list too. Escape-to-close was added to the shared `Modal`, so every
  dialog gets it.
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
