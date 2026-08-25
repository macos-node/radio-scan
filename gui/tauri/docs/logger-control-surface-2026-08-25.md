# Logger control on Linux — the half the tray arc never covered (proposal)

> **Status: PROPOSAL — for the Linux (`adjmx`) session to choose.** Not started,
> nothing decided. Written from macOS after verifying RadioBar's actual control
> semantics against its source; the systemd mapping below is proposed, not tested.
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

## Proposed systemd mapping (untested — Linux to confirm)

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
model transfers. Note the last row: launchd's `jobLoaded` collapses "running" and
"will run again" into one boolean; systemd splits them, and the split is the more
honest model — a stopped-but-enabled stream logger is a *different state* from a
disabled one, and today's macOS UI cannot show that difference.

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

## Also open — version chip + a parity gate

- The chip **already exists in ntune**: `src/App.tsx:801` renders
  `shortVersion(version)` from `getVersion()`, titled `radio-scan L4 UI · v{version}`.
  What's missing is the same chip in **RadioBar**, and an agreed **meaning** for it.
- **Proposed policy (user, 2026-08-25):** bump only when Linux and macOS are at
  parity with no known bugs — i.e. the version asserts *"both platforms do this
  and it works"*, not "code changed".
- §8 (release cadence) does not encode a parity gate today; §3 gates tags on open
  `Needs-verify` but says nothing about feature parity. If this should be enforced
  rather than remembered, it wants a §8 amendment that **both sessions ack**.
  Not drafted — say the word and macOS will write it.

## Not proposed, deliberately

Cross-box awareness in the UI (showing whether the *other* box is covering a
gap). It needs the collation that STATUS.md §1 records as wanted-but-not-built,
and a control surface should not be the thing that invents a data-merge contract.
