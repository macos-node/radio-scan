# ntune — podcast subscriptions made durable (localStorage → Rust store)

> **Status: FIXED 2026-08-11 (Windows `macos-node`). Verified macos 2026-08-12
> (`macos-node`) + Verified linux 2026-08-12 (`adjmx`) — all platforms green.**
> A §2 change note under
> [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md).

## Symptom (Windows)

Imported podcasts vanished on reopen — **stations survived, podcasts didn't**.
Reported after the tray became default-on (v0.1.1-beta.4). Backups (OPML/JSON in
Proton Drive) were fine; the import itself worked in-session. The subscriptions
just never made it back after a restart.

## Root cause — WebView2 only flushes `localStorage` on a graceful shutdown

Two lists, two persistence mechanisms:

| List | Store | Written to disk |
|---|---|---|
| **Stations** | Rust file `stations.json` (`app_data_dir`) | **immediately**, synchronous `std::fs::write` |
| **Podcasts** | webview `localStorage` (`ntune.podcasts`) | **only on a clean WebView2 shutdown** |

Confirmed by driving the running app over the WebView2 remote-debugging protocol
and watching the on-disk LevelDB (`…\uk.fizx.ntune\EBWebView\Default\Local Storage`):

- **Set a key, wait 9 s while the app runs → still not on disk.** WebView2 buffers
  DOM Storage in memory; it does not commit mid-session on any timer we can rely on.
- **Close via the window's X (graceful window-destroy) → the pending write flushes**,
  and it survives a reopen. ✅
- **Force-kill / crash / abrupt exit → the write is lost.** ❌

The smoking gun was in the real profile: only the *continuously* re-written keys
survived (`ntune.positions`, `ntune.volume`); every *write-once* key was gone
(`ntune.podcasts`, plus `ntune.theme` / `ntune.podcastView` / `ntune.stationView`).
Stations survive purely because Rust commits them to a file the instant one is added.

So any exit that isn't a clean window-destroy — a crash, Task Manager, OS
sign-out/shutdown, or the tray's **"Quit ntune"** (`app.exit()` → `std::process::exit`,
which we made reachable-by-default when the tray went default-on) — dropped every
podcast change since the last graceful close. This is almost certainly less severe
on macOS (WKWebView) and Linux (webkit2gtk), which is why it read as Windows-only —
but the design was fragile on every OS.

## Fix — persist subscriptions through Rust, like stations

Podcast subscriptions now live in **`podcasts.json`** next to `stations.json`, written
by two Rust commands that mirror the station store (`src-tauri/src/lib.rs`):

- `list_local_podcasts() -> Vec<PodcastSub>` — the store, `[]` on first run (no seed).
- `save_local_podcasts(subs)` — replaces the list with a synchronous `std::fs::write`.

`PodcastSub { url, title, npub? }` matches the frontend `Sub` shape byte-for-byte,
so the OPML/JSON import/export round-trips unchanged (npub tag preserved).

Frontend (`src/lib/podcasts.ts`): a sync in-memory `cache` fronts the async Rust
store so existing sync callers (`loadSubs()`) keep working.
- `saveSubs()` / `setPodcasts()` update the cache, mirror to localStorage (offline
  fallback), and **write through to `save_local_podcasts` (synchronous on disk)**.
- `initSubs()` runs once at startup (`App.tsx`): loads `list_local_podcasts`; if the
  Rust store is empty **and** legacy `localStorage` has subs, it **migrates** them
  into the durable store (the one-time upgrade path), then dispatches
  `PODCASTS_EVENT` so an open Podcasts tab re-reads.

localStorage is kept only as the migration source and a same-session fallback; the
Rust file is authoritative.

## Verified (Windows, `macos-node`, 2026-08-11)

- `tsc` + `cargo check` clean; release build green.
- **Synchronous write:** `save_local_podcasts` → `podcasts.json` on disk *while the
  app runs* (the thing localStorage never did).
- **Survives the failure mode:** wrote a sub, **hard-killed** ntune (`TerminateProcess`,
  no graceful shutdown), relaunched → `list_local_podcasts` returned it; file intact.
- **Migration:** legacy `localStorage` sub + absent `podcasts.json` → first launch
  migrated it into the store; UI showed it.
- **Full round-trip:** restored a real 31-feed backup through the store; after a
  normal relaunch the Podcasts tab showed all 31 (npub feed kept its `nostr` tag).

## Verified (macOS, `macos-node`, 2026-08-12)

Release build green (Homebrew rustc 1.97.1); `mediaIcon` vitest 11/11. Smoke-tested
on a **real pre-fix profile** — the WebKit `localStorage` held `ntune.podcasts` (a
multi-feed subscription list), `ntune.volume`, `ntune.positions`, but no
`podcasts.json` / `settings.json` on disk yet — i.e. exactly the state the fix is for.

- **Migration:** first launch of the new build wrote
  `~/Library/Application Support/uk.fizx.ntune/podcasts.json` (subscriptions moved
  out of `localStorage`, `nostr` tags preserved) **and** `settings.json`
  (theme / volume / view). Both materialised while the app ran.
- **Synchronous write, live divergence caught in the act:** with the app running,
  `settings.json` held the current `volume: 0.45` while the on-disk WebKit
  `localStorage` sqlite still lagged at `0` (WebKit flushes DOM Storage lazily) —
  the durability gap made visible.
- **Survives the failure mode:** `kill -9` (no graceful close, so `localStorage`
  never flushes) → relaunch → `settings.json` still `0.45`, loaded as authoritative
  (the stale `localStorage` value did *not* win). Under the old localStorage-only
  path that change would have been lost.
- **Fresh-install 0.9 default:** the shipped `loadVolume` guard exercised against
  its truth table — `null`/`""` → `0.9` (the muted-`0` regression), `"0"`→`0`,
  `"0.19"`→`0.19`, out-of-range/garbage → `0.9`. 7/7. (The default only lives in
  in-app audio state until the slider is touched, so there is no on-disk artifact to
  read — hence the logic check.)

## Verified (Linux, `adjmx`, 2026-08-12)

Rebuilt from `main`; `tsc` + `cargo check` clean. Tested on this box's **real
pre-fix profile** — webkit2gtk `localStorage` (`tauri_localhost_0.localstorage`,
UTF-16LE) held `ntune.podcasts` = **11 real feeds** + `ntune.volume`/view keys, and
**no `podcasts.json`/`settings.json`** on disk — exactly the state the fix targets.
`app_data_dir` already resolves correctly on Linux (the existing `stations.json`
lives at `~/.local/share/uk.fizx.ntune/`).

- **Migration + synchronous write:** first launch of the new build wrote
  `~/.local/share/uk.fizx.ntune/podcasts.json` (all **11** feeds, npub tags would be
  preserved — none here) **and** `settings.json` (views + volume 0.27), both
  materialised **while the app ran** (< 0.5 s after launch — the thing localStorage
  never did).
- **Survives the failure mode + Rust store wins:** `kill -9` (no graceful close, so
  `localStorage` never flushes) → then staled the `localStorage` mirror to `[]` →
  relaunch. `podcasts.json` still held all **11** feeds (durable store authoritative,
  ignored the empty mirror), and the app **re-mirrored 11 back to `localStorage`** on
  load — the durable store self-heals the fallback. Under the old localStorage-only
  path the `kill -9` would have lost every sub.

The Linux-specific risks named in the ping — XDG base resolution + webkit2gtk
`localStorage` flush timing — both hold. (Real profile migrated in place; a
pre-migration snapshot was kept during testing.)

## Relation to v0.2.0 (U4.5)

This is the **subscription-list** precursor to the planned harvest-metadata
persistence ([`../../docs/radio-scan-v0.2.0-direction-2026-08-10.md`](../../docs/radio-scan-v0.2.0-direction-2026-08-10.md)):
the *which feeds* now persist durably; the *harvested identity per feed* (author,
categories, language, …) is still the U4.5 work and can extend `PodcastSub` /
`podcasts.json` additively (keyed `podcast:guid`‖url, as that note specifies).
