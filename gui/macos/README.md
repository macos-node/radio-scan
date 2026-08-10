# RadioBar — macOS menubar app

A native SwiftUI (`MenuBarExtra`) front-end for the radio-scan logger. It does
**not** read streams itself — it reads the logger's JSONL output
(`~/RadioTuner/acidjazz_log.jsonl`: `artist` / `title` / `local` / `epoch` per
line) for now-playing, recent tracks and top artists, and pauses/resumes the
`launchd` service that runs the logger.

**macOS-only.** It depends on SwiftUI/AppKit, which don't exist on Linux, so this
target will not build there — the portable half of the project is the Python
core (`radioscan.py`) at the repo root. See [../../SUITE.md](../../SUITE.md).

## Run

```sh
swift build
swift run            # or: .build/debug/RadioBar
```

Menubar-only (no Dock icon). The icon reflects state:

- **antenna broadcasting** → logging is running
- **antenna slashed** → logging is paused

The popover has a **show picker** (persisted) that switches between logged
sources, and adapts to the source's `kind`:

- **`.stream`** (e.g. `acidjazz`) — live now-playing card, last 8 tracks by time,
  status **Logging/Paused**, **Pause/Resume**.
- **`.episodic`** (e.g. On The Wire) — the **latest captured episode**
  (name/date, tracks in running order), status **Scheduled/Off**, plus a
  **Fetch now** button to pull the newest episode on demand.

Both show top artists and buttons to open the data folder, refresh, and quit.

## Build & install app bundle

`build-app.sh` wraps the SwiftPM binary in a double-clickable `.app` (unsigned,
local dev). Three modes:

```sh
./build-app.sh              # build ./RadioBar.app in this folder only
./build-app.sh /some/dir    # build + plain copy to a dir (no quit/relaunch)
./build-app.sh --install    # build → quit running app → install to /Applications → relaunch
```

`--install` is the everyday path: it swaps the running menubar app for the fresh
build in one step (quit is best-effort, so it's safe when nothing's running).
`swift build` / `swift run` alone only refresh the dev binary — the installed
`/Applications/RadioBar.app` is a separate copy, which is what `--install`
updates.

## Status / next

- Multi-show toggle done (2026-08-10): `Show.all` registry drives the picker;
  adding a source is one line. Still coupled to the personal `~/RadioTuner` /
  `com.tigger.*` deployment rather than radio-scan's own multi-station config
  (`~/radio-scan-data/<name>/`) — the registry is the seam to move into a
  `config.json`.
- No login-item yet: add via System Settings > General > Login Items, or use
  `--install` after each rebuild.
