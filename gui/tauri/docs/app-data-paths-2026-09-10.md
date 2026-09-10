# ntune — where the app's data lives on each platform

> **Reference note, 2026-09-10 (Linux `xjmzx` box).** Not a bug report — this is
> the "where do I go to read/back up/inspect my ntune state" answer, written
> down because it gets re-derived every time. Paths verified on Linux; macOS and
> Windows forms are the Tauri conventions the codebase already relies on
> (`%APPDATA%\uk.fizx.ntune\feed-cache\` appears in
> [`../../../docs/platform-parity-2026-08-25.md`](../../../docs/platform-parity-2026-08-25.md)).

## The directory

Everything ntune persists sits in Tauri's `app_data_dir`, keyed by the
`identifier` in [`../src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) — `uk.fizx.ntune`:

| Platform | Release build | Debug build (`make dev` / `tauri dev`) |
|---|---|---|
| **Linux** | `~/.local/share/uk.fizx.ntune/` | `~/.local/share/uk.fizx.ntune-dev/` |
| **macOS** | `~/Library/Application Support/uk.fizx.ntune/` | …`/uk.fizx.ntune-dev/` |
| **Windows** | `%APPDATA%\uk.fizx.ntune\` | `%APPDATA%\uk.fizx.ntune-dev\` |

The `-dev` sibling comes from `dev_sibling()` in
[`../src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) under
`cfg!(debug_assertions)` — the suite-wide isolation convention, so a dev run is
never a second writer against installed state. Release builds are untouched.

On Linux the base honours `$XDG_DATA_HOME` if you have set it; `~/.local/share`
is just the default.

## What's in it

| File | Written by | Contents |
|---|---|---|
| `favorites.jsonl` | `add_favorite` / `remove_favorite` | liked tracks, one JSON object per line |
| `stations.json` | local station store | the live station list (seeded on first run) |
| `podcasts.json` | podcast store | subscriptions — Rust-side since 2026-08-11, see [`podcast-persistence-2026-08-11.md`](podcast-persistence-2026-08-11.md) |
| `settings.json` | `setSetting` | theme and other UI prefs |
| `feed-cache/` | U4.5 slice 4 | cached feed bodies |

`CacheStorage/`, `WebKitCache/`, `localstorage/`, `mediakeys/`, `storage/`,
`cookies`, `hsts-storage.sqlite` are the webview's own scratch, **not** app
state — safe to ignore when backing up, and expected to differ per platform
(WebKitGTK vs WKWebView vs WebView2).

## Reading the favourites log

Append-only JSON Lines, oldest first. One record per like:

```json
{"id":"1789001713034","artist":"Moodorama","title":"Mango Mongo","station":"Acid Jazz","url":"http://79.111.14.76:8000/acidjazz","ts":1789001713}
```

`id` is epoch **millis** (a stable handle for removal), `ts` epoch **seconds**.

```bash
# Linux
cat ~/.local/share/uk.fizx.ntune/favorites.jsonl

# macOS
cat ~/Library/Application\ Support/uk.fizx.ntune/favorites.jsonl
```

```powershell
# Windows
Get-Content $env:APPDATA\uk.fizx.ntune\favorites.jsonl
```

Readable listing with timestamps resolved:

```bash
jq -r '"\(.ts|strflocaltime("%Y-%m-%d %H:%M"))  \(.artist) — \(.title)  [\(.station)]"' ~/.local/share/uk.fizx.ntune/favorites.jsonl
```

The in-app Favourites dialog shows the same records **reversed** (newest first);
the file itself stays in write order.

## Two things that surprise you later

- **The heart matches on `artist` + `title` only** — station-agnostic, by design
  ("I like this track", not "this track here"). Un-liking removes *every* record
  matching that pair, so the same song liked on two stations collapses to one
  unlike. See `isFavorited` / `toggleFavorite` in [`../src/App.tsx`](../src/App.tsx).
- **`station` is free text captured at like-time.** Renaming a station does not
  rewrite old records — an early test entry still reads `Acid Jazz (test)` next
  to newer `Acid Jazz` ones on the identical stream URL. Likewise the `artist`
  string is whatever ICY sent, unsplit: `"Fusion Funk Foundation,Lo Greco Bros"`
  is stored as one artist value.

## Scope

Favourites are **local-only**: no relay publish, no export path, not part of any
backup. Wiping the app-data dir loses them. The signed layer (kind:7 reaction on
`airplay.v1`, keyed to the master-release-key) is still a follow-up — see
[`menubar-companion-2026-08-04.md`](menubar-companion-2026-08-04.md) and the
comment above `struct Favorite` in [`../src-tauri/src/lib.rs`](../src-tauri/src/lib.rs).
