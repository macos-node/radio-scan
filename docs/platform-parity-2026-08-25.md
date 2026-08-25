# radio-scan — three-platform parity ledger (2026-08-25)

> **Status: LEDGER, not a plan.** Written from the Windows session (`macos-node`)
> after 0.2.0-beta.2 became the first Windows build of the v0.2.0 wave. It records
> **what is measured**, **what is assumed**, and **what is still open** per platform,
> so the macOS / Linux / Windows sessions argue from one page instead of three
> half-pictures. Nothing here is decided; the closing section lists options.
>
> **Confidence is marked throughout.** ✅ measured this session · ⚠️ reported but
> **not** conclusively tested · ❔ unknown. Please do not promote a ⚠️ to a fact
> without a run.

## 1. What changed on Windows this session

Two playback defects, both Windows-only, both fixed and measured
([`gui/tauri/docs/windows-playback-2026-08-25.md`](../gui/tauri/docs/windows-playback-2026-08-25.md)):

- ✅ **The Referer 403.** Windows serves the app from the real origin
  `http://tauri.localhost` (mac/Linux use the opaque `tauri://localhost`), so direct
  media requests carried a `Referer` and SomaFM — which refuses hotlinked requests —
  answered **403**. The media element reports that as `SRC_NOT_SUPPORTED`, so it read
  like a codec bug. Fixed with a document-level `<meta name="referrer" content="no-referrer">`.
  (The per-element `referrerpolicy` is ignored for media loads — measured.)
- ✅ **Legacy `audio/aacp`.** The `aacp → aac` remap was gated to Linux, so Windows
  passed the legacy MIME to WebView2, which does not support it. Inverted to "macOS
  keeps the legacy spelling, everyone else gets `audio/aac`".

✅ **HE-AAC decodes natively in WebView2** — no codec install, no GStreamer analogue.
The §5 matrix cell "AAC+ stream plays" is closed for Windows.

## 2. The three now-playing / track surfaces (the thing that keeps confusing us)

There are **two independent sources of track data**, and conflating them is what
produced a wrong conclusion earlier in this session:

| Source | What it is | Covers | Present on |
|---|---|---|---|
| **ntune's ICY proxy** (`proxy.rs`) | in-process loopback relay; parses ICY `metaint` as it streams | **`http://` only** — it has no TLS, and `App.tsx` routes only `http://` through it | all three |
| **`radioscan.py` logger** | separate 24/7 service; opens the stream itself (`urllib` + raw socket) | **http *and* https**, but only stations in that box's `config.json` | macOS (launchd), Linux (systemd) — **not Windows** |

And the **viewer** for logged data differs again:

| Layer | macOS | Linux | Windows |
|---|---|---|---|
| ntune player-bar now-playing | proxy, `http://` only | same | same ✅ |
| ntune tray + `nowplaying.json` bridge | ✅ | ✅ | ✅ verified |
| Logger service | launchd | systemd + **in-ntune control** (U6) | ❌ **none** |
| Logged-data viewer | **Swift RadioBar** (menubar) | **ntune episodic viewer** (Linux-gated) | ❌ **none** |

`lib.rs` states it plainly: the `logger` module is `#[cfg(target_os = "linux")]`, and
`episodic_shows()` returns `[]` off Linux so the UI simply never offers the view —
*"macOS drives the same radio-scan jobs from RadioBar … and Windows runs no logger at all."*

**This is the answer to "why do track lists behave differently per OS":** they are not
one feature with three bugs, they are **two subsystems with different coverage**.

## 3. Measured facts (safe to build on)

- ✅ **0.2.0-beta.2 builds and runs on Windows.** `tsc` clean · vitest 164/164 ·
  `cargo test` 48/48 · release build green · single-instance holds · durable stores
  (`stations/podcasts/settings.json`) survived the U4.5 schema growth in place.
- ✅ **ntune's ICY stripping is byte-exact.** Through-proxy bytes contain zero
  `StreamTitle` occurrences and the ADTS frame chain walks with **zero sync breaks**
  across six `metaint` boundaries. The proxy does not corrupt audio.
- ✅ **`radioscan.py` runs on Windows and reads https ICY.** Verified live with
  `python radioscan.py test` against SomaFM Lush **and** Groove Salad (both https) —
  it returned live `StreamTitle`. The long-deferred "Windows logger" is **viable**,
  not hypothetical. (Python 3.11 present; the script is stdlib-only.)
- ✅ **Lush's stream is healthy.** It sends inline ICY (`Vok - Eg Bid Thin` at the time
  of the probe). If Lush shows no tracks anywhere, the stream is not the reason.
- ✅ **The Acid Jazz / abstract hiphop dropouts are upstream, not ours.** Both are
  genuinely 320 kbps (confirmed by parsing ADTS frame headers: 44.1 kHz, ~929 B/frame).
  A **single clean connection sustained 21 kbps over 45 s — 0.07× realtime**; samples
  ranged 19→325 kbps, with one lucky 1.01× burst, i.e. **zero headroom even at best**.
  Controls are healthy (Drone Zone 161 kbps for a 128 k stream, 1.26×). **Independently
  corroborated: the same two stations drop on macOS too.** No player can fix a source
  that cannot keep up; ntune already reports it honestly (the buffering spinner is
  raised by `waiting`/`stalled`).
  *Testing notes for whoever revisits: run throughput tests **one connection at a time**
  (parallel curls to one host split its bandwidth), and never judge AAC corruption with
  an ADTS parser pointed at MP3 — MP3 shares the `0xFF` sync byte but not the
  frame-length encoding, so it reports phantom "sync breaks".*

## 4. Open / unconfirmed — needs a real cross-platform pass

- ⚠️ **Which stations actually show track data on macOS.** Reported from a brief
  real-time look: SomaFM appeared to work, **Lush did not**. Not conclusively tested,
  and the reporter says so. The plausible reading is that the logger covers only the
  stations in that box's `config.json` (the shipped example lists exactly one), but
  **that is a hypothesis, not a finding.** Someone should check that machine's
  `config.json` against what the UI shows before anyone acts on it.
- ⚠️ **Linux track coverage** — assumed working, not tested this session.
- ❔ **Does ntune's own player bar ever show tracks for `https://` stations on
  mac/Linux?** By code it should not (proxy is `http://`-only). If it does, there is a
  path none of us has mapped, and that would be worth knowing.
- ❔ **Windows: Credential Manager `nsec` round-trip.** The one remaining §5 matrix
  cell for Windows. Needs a real key, so it is the user's to drive.

## 5. The open question: what is Windows' logger + viewer?

macOS answers this with **RadioBar**, a native Swift menubar app — excellent there and
**not portable**. Linux answers it *inside ntune*: a Rust `logger` module driving
`radioscan.py`, plus an episodic viewer in the React UI. Windows currently answers it
not at all.

**Suggestion — Windows should follow the Linux design, not the macOS one.** The Linux
surface is Python + Rust + React, all of which already run on Windows; RadioBar's Swift
never will. Concretely that would mean:

1. **Un-gate the `logger` module** from `#[cfg(target_os = "linux")]` to
   `#[cfg(not(target_os = "macos"))]` — the same inversion the `audio/aacp` fix needed,
   and for the same reason: the rule is "macOS has its own native surface", not
   "Linux is special". The episodic viewer then lights up on Windows with no frontend
   change (`episodic_shows()` already drives it off the command's return).
2. **A Windows service installer** — the Task Scheduler analogue of
   `service/install-macos.sh` / `install-linux.sh`, plus a `config.json`. ✅ The logger
   itself is already proven to run here.
3. **Check the paths** the logger module assumes (systemd unit names, `~/.local/share`,
   process control) — those are the parts that will not port cleanly and need review
   before any of this is attempted.

Cost is moderate and it is genuinely optional: ntune on Windows is a complete *player*
today without it.

## 6. Separately: the in-app https gap (affects all three)

Independent of loggers, ntune's **own** now-playing is `http://`-only everywhere. Giving
the proxy TLS on the upstream leg and routing `https://` through it would light up the
player bar, the tray, and the bridge file for every station on **all three platforms** —
including the many SomaFM mounts that are https.

It is the larger change (the proxy is a raw `TcpStream` with hand-parsed HTTP for the
ICY path) and it moves the working playback path on macOS and Linux, so it needs their
sign-off and re-verification. It also partly overlaps the logger: the logger already
gets https track data where it runs. **The distinction that matters: the proxy feeds
ntune's live readout, the logger feeds history/tallies.** They are not substitutes.

## 7. If you want a suggested order

1. **Nothing urgent.** Windows is a working player as of 0.2.0-beta.2; the two fixes
   above are the ones that mattered.
2. **Cheap and clarifying:** a deliberate cross-platform track-data pass — same handful
   of stations on each OS, recording *where* the text appears (ntune player bar vs
   RadioBar vs episodic viewer) and each box's `config.json`. That single pass would
   settle every ⚠️ in §4 and is a prerequisite for §5/§6 being argued on facts.
3. **Then decide** §6 (in-app https ICY — benefits all three) and §5 (Windows logger —
   benefits Windows only). §6 is the wider win; §5 is the parity win.
4. **Windows `nsec` round-trip** whenever a key is to hand.
