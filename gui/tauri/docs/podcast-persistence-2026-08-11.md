# ntune — podcast subscriptions made durable (localStorage → Rust store)

> **Status: FIXED 2026-08-11 (Windows `macos-node`). Needs-verify: macos, linux**
> (the store is shared TS/Rust — the fix and migration must be smoke-tested where
> the old localStorage path happened to work). A §2 change note under
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

## Needs-verify: macos, linux

Same shared code path. Confirm on each: (1) a subscribe writes
`<app_data_dir>/podcasts.json`; (2) subscriptions survive a restart; (3) a pre-fix
install with `localStorage` subs migrates on first launch. Paths:
macOS `~/Library/Application Support/uk.fizx.ntune/podcasts.json`,
Linux `$XDG_DATA_HOME/uk.fizx.ntune/podcasts.json`.

## Relation to v0.2.0 (U4.5)

This is the **subscription-list** precursor to the planned harvest-metadata
persistence ([`../../docs/radio-scan-v0.2.0-direction-2026-08-10.md`](../../docs/radio-scan-v0.2.0-direction-2026-08-10.md)):
the *which feeds* now persist durably; the *harvested identity per feed* (author,
categories, language, …) is still the U4.5 work and can extend `PodcastSub` /
`podcasts.json` additively (keyed `podcast:guid`‖url, as that note specifies).
