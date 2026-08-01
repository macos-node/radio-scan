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

The popover shows now-playing, the last 8 tracks, top artists, and buttons to
Pause/Resume logging, open the data folder, refresh, and quit.

Clean relaunch (no single-instance guard yet):

```sh
pkill -f RadioBar; sleep 1; swift run &
```

## Status / next

- Hardcoded to the single `acidjazz` station + `com.tigger.acidjazz` launchd
  label — generalize to radio-scan's multi-station config.
- No `.app` bundle or login-item yet, so it must be relaunched manually.
