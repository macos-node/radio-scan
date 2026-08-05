# Handover → Linux (`adjmx`): the two menubar items + the acidjazz logger

> **From:** macOS (`macos-node`) · **2026-08-05** · **For:** Linux (`adjmx`)
> **Status:** ntune U6 tray **merged to `main`** (`b57e041`), **macOS-verified**.
> **Ask:** verify the ntune `--tray` menubar on Linux, and weigh in on the
> open Linux-menubar question below.
> Contract: [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md) ·
> Direction: [`menubar-companion-2026-08-04.md`](menubar-companion-2026-08-04.md).

There are now **two menubar items** on this Mac in the radio-scan world. This
note explains all three moving parts (the Python logger underneath, RadioBar,
and ntune's new tray), what's verified, and what we need from the Linux side.

---

## The three pieces

### 1. The Python acidjazz logger (the thing underneath — macOS host only)
A **personal, single-station** playlist logger that predates everything else and
still runs on this Mac. It is NOT the ntune app and has **no menubar icon of its
own** — it's a background service.

- **Script:** `~/RadioTuner/acidjazz_radio.py` (py3 stdlib only, no deps).
- **What it does:** holds open the Icecast stream
  `http://79.111.14.76:8000/acidjazz`, reads the ICY "now playing" metadata, and
  appends every track change to a log with daily/weekly summaries.
- **Data (the wire contract):** `~/RadioTuner/acidjazz_log.jsonl` is the source
  of truth — one JSON object per line with `artist` / `title` / `local` / `epoch`
  (+ `acidjazz_log.csv`, `station_info.txt`, `summaries/`).
- **How it runs:** launchd agent **`com.tigger.acidjazz`**
  (`~/Library/LaunchAgents/com.tigger.acidjazz.plist`, `KeepAlive=true` +
  `RunAtLoad=true` — survives reboot; killing the PID just respawns it). Pause =
  `launchctl unload …plist`, resume = `launchctl load …plist`.
- **Relationship to this repo:** `acidjazz_radio.py` is the single-station
  **original**; the repo's `radioscan.py` (root) is its multi-station
  **generalization** — same ICY technique, backoff, decode ladder, summary
  layout. The generalization is what feeds the suite's future
  `airplay.v1` (kind 31240) sensor. **The logger is macOS-host-local** — Linux has
  no copy of `~/RadioTuner`, so anything reading that jsonl is macOS-only today.

### 2. RadioBar — macOS-native menubar viewer (`gui/macos/`, macOS-only)
A SwiftUI `MenuBarExtra` app that is a **viewer + controller over the logger**,
not a re-implementation. It reads `~/RadioTuner/acidjazz_log.jsonl` for
now-playing / last-8 / top-artists, and drives the launchd service (Pause/Resume
= `launchctl load|unload`). Installed at `/Applications/RadioBar.app`.

- **macOS-only by construction** — SwiftUI/AppKit don't exist on Linux, so this
  target does not build there. CI runs it on `macos-15` (needs Swift 6).
- Menubar icon = antenna (broadcasting when logging, slashed when paused).
- **This is the richer of the two menus** (now-playing + recent + top artists +
  Pause/Folder/Refresh/Quit), because it has the whole logged history to draw on.

### 3. ntune's `--tray` menubar companion (U6, `gui/tauri/`, cross-platform) — NEW
Merged to `main` this session (`b57e041`; branch `l4-ui-u6`), **macOS-verified**.

- **File:** `src-tauri/src/tray.rs`. **Opt-in behind `--tray`** — an env-arg check
  in `run()`'s setup; the default app (no flag) is completely unchanged.
- **What it reflects:** ntune's **own active playback** — not the logger. It's a
  thin surface over state ntune already owns (U3 now-playing + favorites), not a
  second source of truth. App.tsx pushes derived state via
  `emit("tray-now-playing")`; the tray ♥ hands the click back via
  `emit("tray-favorite")` so it runs the *same* toggle as the in-window heart.
- **Menu:** now-playing label (disabled readout) · Show ntune · ♥ Favorite current
  track (enabled only when there's a live now-playing track) · Quit ntune.
- **Deps added:** `tauri` feature `tray-icon`; Linux `.deb` depend
  `libayatana-appindicator3-1` (already in `tauri.conf.json`).
- **No version bump** — still `0.1.1-beta.2`, so this did NOT disturb that tag.

---

## Where we landed (the "two menubar items" goal)
On macOS right now, both live side by side and that's **intentional — keep both**
(user decision, 2026-08-05). They watch **different sources**:

| | **RadioBar** (📡) | **ntune tray** (📻, new) |
|---|---|---|
| Reads | the passive Python logger's jsonl | ntune's active in-app playback |
| Shows | now-playing + recent + top-artists + controls | now-playing + Show + ♥ + Quit |
| Live even if ntune is closed? | yes (logger runs on its own) | no (only while ntune runs) |
| Platform | macOS-only (Swift) | cross-platform (Tauri) |

So they don't yet do the same job: RadioBar surfaces the *always-on background
logger*; ntune's tray surfaces *what you're actively tuning in ntune*.

---

## What we need from Linux (`adjmx`)

### A. Verify the ntune `--tray` on Linux — the open `Needs-verify: linux`
`cargo check` (with `tray-icon`) and a macOS runtime pass are done; the Linux
tray path is unverified. Please run and report:

```sh
# NOTE the DOUBLE `--` — npm/npx → tauri → cargo → app. A single `--` sends the
# flag to tauri, not the app, and it errors.
npx tauri dev -- -- --tray
```

Check on your DE (note which — GNOME/KDE/Wayland/X11):
1. Does the tray icon appear at all? (Linux shows it via **StatusNotifierItem /
   libayatana-appindicator3**. On **GNOME** this needs the *AppIndicator*
   extension installed/enabled, or no icon shows — that's environment, not a bug.)
2. Does the **menu** open and do its items work — Show ntune, Quit, and ♥ (play an
   `http://` SomaFM seed so U3 now-playing fires, then the ♥ should enable and
   favoriting should work)? **The menu is the contract** — left-click-to-popover
   geometry is desktop-dependent on Linux and we don't rely on it.
3. Does the `.deb` depend `libayatana-appindicator3-1` cover a clean Ubuntu box,
   or is another package needed for the icon to render?

Reply per the contract: a follow-up commit `verified: linux — U6 tray …` (or a
fix commit if something's off). It's **opt-in + not release-critical**, so it does
NOT gate a tag either way.

### B. The open question: what is the Linux menubar story?
RadioBar (the rich viewer) is **macOS-only** and has **no Linux equivalent**. So
on Linux the only menubar surface today is ntune's minimal `--tray`. Two things
to think about together:
- Is ntune's tray meant to eventually **subsume RadioBar's viewer role**
  (recent / top-artists over `radioscan.py`'s own logs, so one cross-platform
  menubar app covers both)? That's the deferred consolidation from
  [`menubar-companion-2026-08-04.md`](menubar-companion-2026-08-04.md) — not
  scheduled, but it's the natural Linux answer.
- If so, note ntune's tray currently reads **ntune playback**, while RadioBar
  reads the **logger jsonl** (`~/RadioTuner` on mac; `radioscan.py`'s layout would
  be the portable equivalent). Bridging those is the real design work.

### C. Anything unclear — ask
This is a two-session repo; if the logger/RadioBar/tray split, the wire contract,
or the `--tray` plumbing doesn't match what you see on Linux, raise it here or in
`STATUS.md` and we'll reconcile before building further.

---

## Verified on Linux (`adjmx`, 2026-08-05) — PASS

Verified via the installed release build (`make install` → `ntune --tray`, i.e.
the packaged secure-origin path) and in normal use.

- **Environment:** Ubuntu 24.04, **GNOME on X11**; AppIndicator extension
  `ubuntu-appindicators@ubuntu.com` enabled.
- **1. Icon:** appears in the top bar via StatusNotifierItem
  (`libayatana-appindicator3-1`) + the GNOME AppIndicator extension.
- **2. Menu:** opens; **Show ntune** and **Quit** work. **♥ is disabled with
  nothing playing and enables only on a live now-playing track** — played an
  `http://` SomaFM seed and the acidjazz stream, U3 fired, ♥ enabled, and the
  favorite was stored to `favorites.jsonl`. The menu is the contract, as noted.
- **3. `.deb` depend:** `libayatana-appindicator3-1` renders the icon on
  KDE/XFCE/Cinnamon/MATE — **but on GNOME the shell AppIndicator extension is also
  required or no icon shows**, and a `Depends`/`Recommends` can't install a shell
  extension. Worth a line in this doc for clean-GNOME-Ubuntu users: it's an
  environment prerequisite, not a bug.

Beyond the ask, the Linux side also made the **frontend the single source of
truth** (label clears on stop; ♥ gates exactly like the in-window heart), wired
the **favorite handoff** (`tray-favorite` → same `toggleFavorite`), and set the
**installed desktop entry to default to `ntune --tray`** (drop the flag on a DE
that can't host an SNI tray — no rebuild).

**B (Linux menubar story):** lean **yes** — ntune's tray should grow toward
RadioBar's viewer role on Linux, sourced from `radioscan.py`'s portable log
layout (not the mac-only `~/RadioTuner`). Bridging *ntune-playback* vs
*logger-jsonl* is the real work; captured in the
[`menubar-companion-2026-08-04.md`](menubar-companion-2026-08-04.md) open
decisions (feedback + richer menu → RadioBar parity). Unscheduled.

---

## Quick reference (paths)
- Logger: `~/RadioTuner/acidjazz_radio.py` · launchd `com.tigger.acidjazz` ·
  jsonl `~/RadioTuner/acidjazz_log.jsonl` (mac host only)
- Portable core: `radioscan.py` (repo root)
- RadioBar (macOS): `gui/macos/` → `/Applications/RadioBar.app`
- ntune tray (cross-platform): `gui/tauri/src-tauri/src/tray.rs`, run with
  `npx tauri dev -- -- --tray`
- Merge: `main` @ `b57e041` (U6 + `verified: macos`); still `0.1.1-beta.2`
