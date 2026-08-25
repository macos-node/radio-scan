# Logger control on Linux — the half the tray arc never covered (proposal)

> **Status: BUILT 2026-08-25 (Linux `adjmx`) — option A, shipped and driven
> end-to-end in the installed app.** Written from macOS after verifying RadioBar's
> actual control semantics against its source; the systemd mapping below is
> confirmed on Linux, and the section at the bottom records what the build changed
> about the plan.
> Contract: [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md).
> Companion to [`menubar-companion-2026-08-04.md`](menubar-companion-2026-08-04.md),
> which this sharpens rather than replaces.

## The distinction the direction doc blurs

`menubar-companion-2026-08-04.md` frames the tray as a **now-playing viewer** and
says the tray should reflect *ntune's* playback "not RadioBar's current coupling to
the personal `~/RadioTuner` logger — reconcile that coupling when this lands."

That coupling isn't a wart to reconcile away. RadioBar is **two surfaces in one
menubar**:

1. a **viewer** over the logger's JSONL — now-playing, recent, top artists
2. a **controller** of the logging jobs — pause/resume, fetch-now

The tray work (U6, `--tray`) delivered a cross-platform answer for **(1) only**.
**(2) has no Linux equivalent at all**, and it is the one with real consequences:
on macOS, logging is paused and resumed from a menu; on Linux it can only be
driven by hand with `systemctl --user`. That asymmetry is now load-bearing,
because since 2026-08-25 **both boxes log the same acidjazz stream** (STATUS.md
§1, `dcdd678`) — so pausing is a routine, per-box act, not a one-off.

## Reference semantics — what RadioBar actually does

Verified against `gui/macos/Sources/RadioBar/RadioBarApp.swift` on 2026-08-25,
because the behaviour is easy to presume wrongly (it was, here, before reading it):

- **Quit does NOT touch launchd.** `Button("Quit") { NSApplication.shared.terminate(nil) }`
  — it closes the app and **leaves the logger running**. Quit is not a stop.
- **Pause/Resume is the control.** `toggleLogging()` runs
  `launchctl load|unload <plist>`.
- **Durability is per show-kind, deliberately:**
  | kind | toggle | meaning |
  |---|---|---|
  | `.stream` (acidjazz) | `unload` **without `-w`** | session-only; a 24/7 logger **auto-resumes at next boot** |
  | `.episodic` (otw, duck) | `unload` **with `-w`** | persistent Disabled override; **survives reboot** |
- **Fetch-now** (episodic only): `load -w` if needed, then `start <label>`.

That asymmetry is the interesting part and worth preserving on any platform: a
continuous logger shouldn't stay dead because you paused it once, and a weekly
show you deliberately silenced shouldn't quietly restart. **A Linux surface that
maps every pause to the same durability would be a regression** even though it
would look identical in a menu.

## The systemd mapping — CONFIRMED on Linux 2026-08-25

Units from `service/install-linux.sh` + `install-linux-episodic.sh`:
`radio-scan.service` (stream), `otw-playlist.timer` / `duck-playlist.timer`
(episodic).

| RadioBar | systemd equivalent |
|---|---|
| `.stream` pause (session-only) | `systemctl --user stop radio-scan.service` — leaves it enabled, so it returns at next login |
| `.stream` resume | `systemctl --user start radio-scan.service` |
| `.episodic` pause (persistent) | `systemctl --user disable --now <show>-playlist.timer` |
| `.episodic` resume | `systemctl --user enable --now <show>-playlist.timer` |
| fetch-now | `systemctl --user start <show>-playlist.service` (the service, not the timer) |
| "is it running" | `systemctl --user is-active` / `is-enabled` — **two questions, not one** |

`stop` vs `disable` is exactly launchd's `-w` distinction, which is a good sign the
model transfers. Measured on this box, each transition read back with `is-active`
and `is-enabled`:

| step | `is-active` | `is-enabled` |
|---|---|---|
| `radio-scan.service` baseline | active | enabled |
| after `stop` | **inactive** | **enabled** |
| after `start` | active | enabled |
| `duck-playlist.timer` baseline | active | enabled |
| after `disable --now` | **inactive** | **disabled** |
| after `enable --now` | active | enabled |

So the durability asymmetry holds as proposed: stopping the stream logger leaves
it enabled and it comes back on its own, while disabling an episodic timer stays
disabled across a reboot. Note the last row of the mapping table, which that
`stop` line demonstrates: launchd's `jobLoaded` collapses "running" and "will run
again" into one boolean; systemd splits them, and the split is the more honest
model — **inactive + enabled** is a real, reachable state that today's macOS UI
cannot express. Any menu built from this has to render two facts per job, not a
checkbox.

## Where it should live — options

**A. ntune's tray grows logger control.** Reuses the `--tray` plumbing already in
`src-tauri/src/tray.rs`, one binary, closes the Linux gap directly, and matches the
doc's existing "likely the cleanest path" call for the viewer half.
*Cost:* it puts a **second source of truth** in one menu — ntune's playback state
and the logger's job state are unrelated, and "Pause" would mean two different
things three menu items apart. Mitigation: separate, labelled sections, never a
single merged Pause.

**B. A separate small Linux controller.** Keeps the two sources of truth apart, and
mirrors RadioBar's shape (a controller for the logger, nothing to do with ntune).
*Cost:* another app to build and ship; no reuse of the tray work.

**C. Leave it CLI.** The timers self-heal since `0feed94`, so nothing is broken
without a UI.
*Cost:* the asymmetry stays — Mac gets a menu, Linux gets a man page.

**Recommendation: A, with hard separation in the menu** — but the source-of-truth
objection is real and this is the Linux session's call, since it is the platform
that has to live with the result.

### Decision (Linux `adjmx`, 2026-08-25): A

Taken with the mitigation as a **requirement, not a note**: separate labelled
sections, and never a single merged "Pause". The source-of-truth objection is the
right objection and it is what the build has to answer — but it is a menu-layout
problem, and B pays for it with a whole second app while C leaves the platform
asymmetry permanent — which §8.1 (accepted, as a guide, the same day) says to
either close or write down as intended. Closing it is better than recording it.

Two constraints on the build, both from the confirmed mapping above:

1. **Two facts per job, never one.** `is-active` and `is-enabled` are different
   questions and the stopped-but-enabled state is reachable in normal use. A
   checkbox would lie about it.
2. **Durability follows the job kind, not the menu item.** Stream pause is
   `stop`; episodic pause is `disable --now`. Mapping both to the same verb would
   look identical in a menu and be a regression — a 24/7 logger that stays dead
   after a pause, or a weekly show that quietly restarts.

### Built (Linux `adjmx`, 2026-08-25) — and two things the plan didn't know

`src-tauri/src/logger.rs` (Linux-only) + a LOGGER section in `tray.rs`. Both
constraints above are honoured, and both were worth having: the labels read
`Acid Jazz — logging` / `— stopped · returns at login` / `On The Wire — paused ·
stays off`, and every verb names its job and says "logging".

Driven through the real tray on this box: stream pause left the unit **inactive +
enabled** and episodic pause left it **inactive + disabled** — the same click,
different durability, different words, which is the design's whole claim. Resume
restored both, fetch-now ran `duck-playlist.service` to completion including its
`--clean` step.

**The status could not live in a submenu label.** The plan implied one row per
job; the first build did that, with the status in the submenu's label. On Linux
the tray is a StatusNotifierItem and the menu crosses DBusMenu, where
`MenuItem::set_text` propagates and **`Submenu::set_text` does not** — caught
because the item *inside* the submenu had flipped to "Resume logging" while the
label above it still said "logging". So the section is flat: a disabled status row
per job, exactly like the `now_playing` readout at the top of the same menu, plus
its actions. Costs rows, keeps the status true.

**Pause had to be made to work before it could be offered.** Clicking pause on the
stream logger appeared to hang and then left the unit `failed`. `radioscan.py`
handles SIGTERM correctly, but the ICY generator only returned control to that
handler on a **track change**, so systemd waited out its 90s `TimeoutStopSec` and
SIGKILLed. The generator now checks the stop event every metaint block: a stop
takes **0.16s** and lands `inactive`, not `failed`. That fix is in the shared
Python, so launchd's `unload` on macOS gets it too.

### The read half, built the same day — and a distinction the framing above blurs

This document says the tray "delivered a cross-platform answer for (1) only",
counting the viewer as done. That is true of the tray's NOW-PLAYING readout and
not of the thing (1) actually describes: RadioBar's viewer reads *the logger's
JSONL*, while the tray reads `nowplaying.json`, which is ntune's own playback.
They are different sources answering different questions, and on Linux the
logger's data had no reader at all.

So there is now an episodic viewer in ntune (`logger::latest_episodes()` +
`components/EpisodicDialog.tsx`, behind a toolbar button that appears only when
logs exist): latest episode per weekly show, its tracklist, and a **Listen on
Mixcloud** link-out where the parser captured one. Read-only — it cannot fetch and
cannot write, so a stale view means the timer hasn't run, which is what the tray's
LOGGER section is for.

Two decisions worth recording. It reads the CLEAN log by preference and falls back
to the raw one, because `--clean` runs as ExecStartPost on every scheduled fetch
and is therefore current, while a log that has never been cleaned still shows
rather than appearing empty. And a show with no captured link says so instead of
offering a dead button — On The Wire publishes no audio, so a link-out is the only
honest action there is, and Duck legitimately has none because it is a real
podcast you play in ntune itself.

**Still Linux-only, and now in both directions** (§8.1: intended, recorded here).
macOS reads these logs in RadioBar. What RadioBar does NOT yet have is the
link-out: its `Track` decoder has a fixed field list, so `listen_url` is invisible
to it even after pulling the parser — its only open action is `openDataFolder()`.
macOS's call whether that is worth closing.

Still not built, and still deliberately: cross-box awareness (below).

## Also open — version chip + a parity gate

- The chip **already exists in ntune**: `src/App.tsx:801` renders
  `shortVersion(version)` from `getVersion()`, titled `radio-scan L4 UI · v{version}`.
  What's missing is the same chip in **RadioBar**, and an agreed **meaning** for it.
- **Proposed policy (user, 2026-08-25):** bump only when Linux and macOS are at
  parity with no known bugs — i.e. the version asserts *"both platforms do this
  and it works"*, not "code changed".
- ~~§8 does not encode a parity gate today~~ — **settled, and smaller than the
  draft: §8.1 was accepted 2026-08-25 as a GUIDE, not a gate.** The policy behind
  it was a general steer against the platforms drifting apart, and "no bugs" was
  loose phrasing for *we want the betas we cut to be stable ones*. Neither was a
  request for release machinery, and neither said so — the draft read what it was
  given. Nothing in §8.1 blocks a tag. This document is
  still exactly the kind of record it asks for: RadioBar's logger control being
  macOS-only is a divergence, now written down together with the decision to close
  it.
- Still open: **the version chip in RadioBar**, which ntune has
  (`src/App.tsx:801`) and RadioBar does not. macOS's call.

## Not proposed, deliberately

Cross-box awareness in the UI (showing whether the *other* box is covering a
gap). It needs the collation that STATUS.md §1 records as wanted-but-not-built,
and a control surface should not be the thing that invents a data-merge contract.
