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
- ~~❔ **Windows: Credential Manager `nsec` round-trip.**~~ ✅ **VERIFIED 2026-08-25** —
  see §9. **Windows now has no open §5 matrix cell.**

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

## 8. Picking this up — concrete groundwork (surveyed 2026-08-25, nothing built)

### Which to start with

**Start with the track-data pass (§7.2), and not because it blocks the build.** The
Windows logger is additive and well-defined — Windows has no logger, so nothing has to
be understood first to add one. The reason to measure first is that it may **redirect
the effort**: if what is actually missed day to day is ntune's **player-bar readout**,
then §6 (in-app https ICY) is the higher-value job — it fixes **all three** platforms,
where the Windows logger fixes one. The pass is an hour and could save a week of
building the less useful thing.

### If/when the Windows logger is the choice: the port is naturally staged

✅ **`logger.rs` (419 lines) splits cleanly in two**, so this does not have to be
all-or-nothing:

| Half | Functions | Portable? |
|---|---|---|
| **Read** | `data_dir`, `pos_key`, `as_str`, `latest_episode`, `latest_episodes`, `EpisodicShow/Track` | ✅ pure file + JSON — ports as-is (bar the trap below) |
| **Control** | `parse_show`, `query`, `describe`, `is_on`, `toggle_args`, `fetch_args`, `run`, the `Job`/`Kind` unit table | ❌ **systemd-only** — shells `systemctl --user` and parses `systemctl show` |

So **stage 1** is the read half: un-gate it, and the episodic viewer + "new episode" dot
light up on Windows with **no frontend change** (`episodic_shows()` already drives the UI
off the command's return, and returns `[]` where there is nothing). **Stage 2** — the
pause/resume/fetch-now controls — is the real work, because Task Scheduler's model is
nothing like systemd's and the `Job` table is a hardcoded list of units. Stage 2 is
optional: a viewer with no controls is still useful, and the user can manage the task.

### Two portability traps found by inspection (fix these first, they are cheap)

1. **`data_dir()` will silently find nothing on Windows.** `logger.rs` resolves
   `std::env::var("HOME")`, and **`HOME` is not set on Windows** for a GUI-launched app
   (Git Bash sets it; Explorer does not). Meanwhile `radioscan.py` uses
   `os.path.expanduser(os.environ.get("RADIOSCAN_DATA", "~/radio-scan-data"))`, and
   `expanduser("~")` on Windows resolves to **`%USERPROFILE%`**. So the writer would use
   `C:\Users\<you>\radio-scan-data` while the reader returned `None` — the exact
   divergence the comment above `data_dir()` says must not happen. Fix: fall back to
   `USERPROFILE` on Windows (keep `RADIOSCAN_DATA` first, so the override still wins).
2. **Graceful shutdown does not port.** `radioscan.py` installs
   `signal.signal(SIGTERM/SIGINT, _handle)` for a clean stop. On Windows a SIGTERM is
   not delivered the way Unix delivers it — `os.kill(pid, SIGTERM)` maps to an immediate
   `TerminateProcess`, so the handler never runs. The logger **appends JSONL**, so a hard
   kill can land mid-line. Worth deciding how a Windows task is stopped (a CTRL_BREAK
   console event, or a stop-file the loop polls) before running one 24/7.

### The cheapest possible first move, whenever

Run the logger on Windows for real — not the `test` probe, the actual `run`:

```bash
python radioscan.py run --config config.json
```

with a `config.json` copied from `config.example.json`. ✅ `test` already works here
(it pulled live ICY off SomaFM Lush and Groove Salad over **https**), but `run` is what
exercises the write path, the data-dir layout, and the stop behaviour — i.e. traps 1
and 2 above. It writes only into its data dir and needs no service, no install, and no
code change, so it is a genuinely free experiment and the honest prerequisite for
everything in stage 1.

## 9. Windows session results — 2026-08-25 (identity, caches, and the §8 experiment)

Run at the end of the session, with a real `nsec` entered into the app by the user.

### ✅ Credential Manager `nsec` round-trip — the last Windows §5 cell, now closed

- The credential exists: `cmdkey /list` shows target **`default.ntune`**, matching
  `KEYRING_USER="default"` + `KEYRING_SERVICE_RELEASE="ntune"` (`lib.rs`). The
  `windows-native` keyring backend writes where it should.
- **Read-back proven on a cold process**: ntune was killed and relaunched, and
  `get_identity` returned the correct npub/pk. Deriving the right public key requires
  successfully reading *and* decoding the stored secret, so this exercises the whole
  round-trip. The `nsec` itself never crosses the IPC boundary (only npub/pk come back)
  and was never printed during testing.

**With that, Windows has no open cell in the §5 matrix.**

### ✅ Caches and U4.5 persistence are working on Windows

- **Feed-body cache** (U4.5 slice 4): `%APPDATA%\uk.fizx.ntune\feed-cache\` holds many
  cached feed documents (hundreds of KB each for the big ones).
- **Harvest persistence**: `podcasts.json` grew 3.4 KB → 16.9 KB; of 31 subs, **21 carry
  a `harvest` slice, 8 a `podcast:guid`, 14 a `latestAt`**.
- **Relay sync reads**: with the identity loaded, **11 `station.v1` (31241)** and
  **26 `show.v1` (31242)** were read back for that pubkey, from two relays.
- Local vs published deliberately differ (5 local stations vs 11 published; 31 local
  subs vs 26 published shows). That is decision #11 working as designed — publishing a
  station is separate from keeping it — not drift.

### ✅ The §8 experiment: `radioscan.py run` works on Windows

`python radioscan.py run --config config.json` against **https** SomaFM Groove Salad:
captured a live track (`BistroBoy - Forgive`), and wrote `*_log.jsonl`, `*_log.csv`,
`station_info.txt` and `summaries/` (daily + weekly + overall). **Stream logging works
on Windows, over https.**

### ⚠️ Trap #1 CONFIRMED empirically (was inspection-only)

Python resolved `~` to **`%USERPROFILE%`** and wrote to
`C:\Users\<you>\radio-scan-data\`. `logger.rs::data_dir()` reads `HOME`, which is unset
for a GUI-launched app on Windows — so writer and reader **would** diverge exactly as
predicted. Fix it before any stage-1 port.

### ⚠️ Trap #2 CONFIRMED — but milder than feared

`taskkill /PID <pid>` (the polite path) is **refused**: *"This process can only be
terminated forcefully"* — a console process has no window to receive `WM_CLOSE`. Only
`/F` works, and that is `TerminateProcess`, so the `SIGTERM` handler never runs and
`close_live_streams()` + the final summary write are skipped. **However, the JSONL
survived intact** (every line still valid JSON, no truncated tail) in this run, so the
practical risk is "no clean shutdown", not demonstrated corruption. A Windows service
still wants a real stop mechanism (a `CTRL_BREAK` console event, or a stop-file the loop
polls).

### 🐛 NEW BUG, and it is NOT Windows-specific: the log filename is hardcoded

`radioscan.py` lines 66-67:

```python
self.jsonl = os.path.join(self.dir, "acidjazz_log.jsonl")
self.csv   = os.path.join(self.dir, "acidjazz_log.csv")
```

The **directory** is per-station (`<data_dir>/<name>/`) but the **filename is always
`acidjazz_log.*`**, whatever the station is called. Logging `groovesalad` produced
`radio-scan-data/groovesalad/acidjazz_log.jsonl`.

This matters beyond cosmetics, because the Rust reader disagrees —
`logger.rs::latest_episode` builds `<data_dir>/<log>/<log>_log.jsonl`. The two only
agree when `name == "acidjazz"`, which is precisely the deployed stream logger, so the
mismatch has been **masked on macOS and Linux**. Any second stream station would write a
log the reader cannot find.

**✅ FIXED 2026-08-25, after macOS corroborated it.** The macOS session did not take the
Windows finding on trust — it **reproduced the bug on demand** on its own box, logging a
scratch station (`--name somafm`) against the live stream and getting
`somafm/acidjazz_log.jsonl`. Two independent platforms, one live reproduction each.

macOS also supplied the distinction that makes the fix safe, and it is worth keeping:

- Of the three shows that box logs, **only one is a `radioscan.py` station** (Acid Jazz,
  an Icecast stream). **On The Wire and A Duck in a Tree are RSS episodic parsers**
  (`episodic/otw_playlist.py`, `duck_playlist.py`) which **never touch `Station`** — they
  derive filenames from their own `SOURCE` constant (`"otw"` → `otw_log.jsonl`). Verified
  from Windows too. They are therefore **immune by not sharing the code, not by design** —
  a distinction that matters if that hardcoding is ever revisited.
- Nothing was mismatched in the wild on **either** box: the sole deployed radioscan
  station is literally named `acidjazz`, the one case where the literal is accidentally
  correct. Windows' only mismatching folder (`groovesalad/acidjazz_log.jsonl`) came from
  today's experiment, and Windows runs no logger service at all. **This was a latent
  fault waiting for station two, not damage to existing logs.**

Fix: `f"{name}_log.jsonl"` / `.csv`, plus the module docstring, which had documented the
literal. **Verified:** `acidjazz` → `acidjazz_log.jsonl` (**byte-identical to the deployed
path — no migration, nothing to re-point**), `groovesalad` → `groovesalad_log.jsonl`, and a
live re-run still logged a real track. `py_compile` clean (what the Python CI job runs).
