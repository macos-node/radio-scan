# ntune — radio-scan L4 desktop UI

The **tuner / player / subscription** surface of [radio-scan](../../README.md) —
the n-suite's listening front-end. Where the L1 Python sensor *observes* what
stations play (and discards the audio), ntune *plays* them: tune a stream,
follow it, and (later phases) subscribe to podcasts and per-npub audio feeds.

> Build map & phased plan: [`../../docs/radio-scan-ui-2026-08-04.md`](../../docs/radio-scan-ui-2026-08-04.md).
> Suite conventions & wire contract: [`../../SUITE.md`](../../SUITE.md),
> [`../../schema/airplay-design-2026-07-28.md`](../../schema/airplay-design-2026-07-28.md).

## Status — **U0 (scaffold)**

A working internet-radio player. Stations live in a **local store**
(`stations.json` in the app-data dir), seeded from a handful of SomaFM stations
on first run (`seed_stations`); adds persist there with no Nostr key and every
seed is a removable row. It lists them and plays the selected stream in the
webview `<audio>` element with play/stop and volume. When signed in, an add also
publishes a `station.v1` to the relays as an overlay:

| Phase | Adds |
|-------|------|
| **U0** ✅ | Tauri shell, themes, tune & listen (webview `<audio>`) |
| U1 | Station list from `station.v1` (31241) off the relays |
| U2 | Follow = publish `station.v1` (keyring `nsec`) |
| U3 | Now-playing via a Rust loopback ICY proxy (port of `radioscan.py`) |
| U4 | Podcast RSS (`feed-rs`) + per-npub `1063` feed tabs |
| U5 | Polish: spectrum, gapless, NIP-46, `feed.v1` notes |

## Develop

```bash
make deps     # npm install + cargo fetch (one-time)
make dev      # tauri dev (hot-reload)
make check    # tsc + vite build + cargo check
make icons    # regenerate the raster icon set from icon.svg
make install  # binary + .desktop under ~/.local  (Linux)
```

**macOS** — build + install the `.app` to `/Applications` and relaunch, in one
step (the ntune analog of RadioBar's `build-app.sh --install`):

```bash
npm run install:app          # or: ./install.sh
./install.sh --skip-build    # reinstall the last build without rebuilding
```

Stack: Tauri 2 · React 19 · TypeScript · Tailwind v3 — matching the rest of the
suite (`nplay`/`ndisc`). Cross-platform, developed on Linux even though the
repo's home is `macos-node` (the sensor's macOS service is the reason for that
home; the UI is not macOS-bound).

## Menubar / tray companion (`--tray`)

An opt-in menubar/tray now-playing companion (U6). Launch with the flag:

```bash
npx tauri dev -- -- --tray     # dev — note the DOUBLE `--` (npm/npx → tauri → cargo → app)
ntune --tray                   # installed build
```

The installed Linux desktop entry launches with `--tray` by default; macOS is
opt-in (pass the flag). **GNOME users:** the tray icon needs the shell
AppIndicator extension (`gnome-shell-extension-appindicator`, e.g.
`ubuntu-appindicators@ubuntu.com`) enabled in addition to the packaged
`libayatana-appindicator3-1` — without it no icon shows (it's an environment
prerequisite, not a bug). Other desktops (KDE/XFCE/Cinnamon/MATE) need only the
library.
