# ntune ↔ menubar now-playing bridge — direction, plan, aims

> **Status: DESIGN — NOT STARTED. Read before building any platform's menubar /
> tray surface.** This is a §2 "design-review-first" note under
> [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md). It exists
> so the **macOS**, **Linux** (`adjmx`), and now the **Windows** (prototyping)
> sessions build *to one contract* instead of discovering it after. Nothing here
> is built yet; the seams named below already exist as of **v0.1.1-beta.4**.
> Supersedes the open question in [`menubar-companion-2026-08-04.md`](menubar-companion-2026-08-04.md)
> with a concrete, cross-platform mechanism.
>
> **Path table 2026-08-11 — Windows FROZEN/ACKED; macOS + Linux acks pending.**
> See "THE decision" for the frozen table and the *Acknowledgement log* at the
> bottom. `write_nowplaying` stays blocked until all three ack.

## Aim (one sentence)
**One now-playing "fabric": whatever ntune is playing is reflected on a small
menubar/tray surface, and — for episodes — that surface *locates the show and
shows its tracklist*.** Same behaviour on macOS, Linux, and Windows.

## The reframe that makes it cross-platform
Do **not** build "ntune → RadioBar" (that's macOS-only). Build a **shared local
now-playing *contract*** — a small state file one producer writes and any surface
reads. This is the whole cross-platform decision: a **file** works identically on
all three OSes (no ports, no daemon, no IPC), and both a Rust/Tauri app and a
native Swift app can read/write it.

```
   PRODUCERS                 SHARED STATE                CONSUMERS (surfaces)
  ┌──────────┐                                         ┌─────────────────────┐
  │  ntune   │──write──▶  nowplaying.json  ◀──poll─────│ RadioBar (macOS,     │
  │ (nplay…) │            {live, local}    ◀──poll─────│   native Swift)      │
  └──────────┘                 │                        │ ntune tray (win/lin/ │
                               │                        │   mac — tray.rs)     │
                               └── consumer-side join → *_log.audio_url → tracklist
```

## What we already have (the seam, as of beta.4)
- ntune `Playing` model (`current`) — `{kind:"station"|"episode", key, title,
  subtitle?, url, seekable}` (`src/lib/player.ts`).
- ntune already **fans now-playing out to a sink** — `emitTrayNowPlaying` in the
  `useEffect` at `App.tsx` (fires on `nowPlaying/playing/current` change). **The
  bridge is one more sink on that exact effect.**
- `tray.rs` (`--tray`) — the cross-platform tray surface (mac/Win/Linux) already
  scaffolded; consumes the same now-playing state in-process today.
- RadioBar (macOS, Swift) — `.stream`/`.episodic` show registry, renders an
  episode's tracklist from the logs; polls files every 15 s already.
- **The join key:** an episode's `enclosureUrl` (`Playing.url`) equals
  `duck_log.audio_url`. So "locate show + tracklist" is a pure consumer-side
  lookup — the producer emits nothing extra.

## The contract (settle the shape, then it's frozen additive-only)
`nowplaying.json`, written by the producer, deliberately **airplay.v1-adjacent**
(reuses `r`/`artist`/`title` names so it's a subset precursor, not a fork):

```json
{
  "kind": "station",                          // "station" | "episode"
  "key": "acid-jazz",                         // slug | episode id
  "r": "http://79.111.14.76:8000/acidjazz",   // stream/enclosure URL = join key + airplay #r
  "title": "…", "subtitle": "…",
  "artist": "…", "track": "…",                // live ICY (station only)
  "playing": true,
  "ts": 1786000000
}
```

Consumer rule: `kind=="station"` → show the live ICY track; `kind=="episode"` →
match `r` to an episodic log's `audio_url` → render that episode's located
tracklist.

## The three tiers (so nobody confuses them)
1. **Live / local** — this file. What the menubar shows. **Local-by-default**;
   never leaves the machine. (airplay.v1 privacy note is explicit: a live
   now-playing ticker is a *separate, later, opt-in* choice from aggregate
   sharing.)
2. **Tally / history** — the loggers (`~/RadioTuner/*_log.jsonl`).
3. **Published aggregate** — opt-in `airplay.v1` (kind 31240), rolled up from the
   tallies. Same `{r, artist, title}` fields → the live file's serialization is a
   subset of the eventual event.

## THE decision to make before any platform build
**Where does `nowplaying.json` live, and how is the path resolved per-OS?**
This is the one thing all three sessions must agree on *first*, because a
mismatch means the surfaces silently never see each other.

### Resolution — one product-scoped constant, resolved off the OS *base* dir
`nowplaying.json` lives under a **product-scoped `radio-scan/` directory**: one
shared path constant (`radio-scan/nowplaying.json`) appended to each OS's *base*
local-data dir. Deliberately **not** the per-app bundle-id dir (`uk.fizx.ntune`):
the producer is Tauri, but a consumer is **native Swift (RadioBar)** with no
knowledge of the Tauri identifier, so the rendezvous path must be derivable
without it. Producer resolves the **base** dir (Tauri `local_data_dir()` /
`%LOCALAPPDATA%` / XDG — *not* `app_local_data_dir()`, which would append the
bundle id) and joins the constant. The native reader hardcodes the same constant
off its own base dir.

| Session | OS base dir | Frozen path to `nowplaying.json` | State |
|---|---|---|---|
| **Windows** (`macos-node`, prototyping) | `%LOCALAPPDATA%` | `%LOCALAPPDATA%\radio-scan\nowplaying.json` | **FROZEN / ACKED 2026-08-11** |
| macOS (`macos-node`) | `~/Library/Application Support` | `~/Library/Application Support/radio-scan/nowplaying.json` | proposed — **pending macOS ack** |
| Linux (`adjmx`) | `$XDG_DATA_HOME` (`~/.local/share`) | `$XDG_DATA_HOME/radio-scan/nowplaying.json` | proposed — **pending Linux ack** |

Consistency argues for `local_data_dir()` on all three (the `%LOCALAPPDATA%` /
Application Support analogue). Linux (`adjmx`) may instead prefer `$XDG_STATE_HOME`
(`~/.local/state`) for a transient live-state file — its call to freeze on ack.

**Open sub-question kicked to macOS.** RadioBar today reads `~/RadioTuner`
(personal deployment) / `~/radio-scan-data/<name>` (radioscan layout) — the §5
"coupling to fix." When RadioBar moves off `~/RadioTuner` to the shared
`…/radio-scan/` dir, does it relocate **only the live `nowplaying.json`** (tier 1),
or **also the tally loggers** `*_log.jsonl` (tier 2)? macOS owns that call — it
decides whether live + history share one root or stay split.

**Agree this path + the payload shape in this doc before writing code.**

## Per-platform aims (build to these)
- **macOS** — two consumers: native **RadioBar** (Swift, file-poll + join, ships
  today) *and* ntune's Tauri **tray**. Both read the same file.
- **Linux** (`adjmx`) — the Tauri **tray** is the surface (StatusNotifierItem /
  appindicator; GNOME needs the shell extension — see
  [`menubar-handover-linux-2026-08-05.md`](menubar-handover-linux-2026-08-05.md)).
  No native equivalent; the file contract is the same.
- **Windows** (prototyping) — the Tauri **tray** is the surface; add a **Windows
  row to the §5 matrix** in the cross-session contract when this is built. Path =
  `%LOCALAPPDATA%`. No native app; same file contract.

## Scope guardrails
- **One-way for v1** (producer → file → surfaces). RadioBar → ntune ("play this")
  is a separate, later extension.
- **Tracklist, not a live cursor** — episodic tracklists have order but no
  per-track timecodes, so a played episode shows its *full* tracklist, not a
  moving highlight. The ICY **stream** is the only source with a true live cursor.
- **On The Wire** has no `url`/enclosure to join on → it won't appear in the
  playing-now surface unless it gains a real stream; log-only, as elsewhere.

## Smallest first step (once the path + shape are agreed)
1. ntune: a tiny Rust `write_nowplaying(state)` (`std::fs::write`, portable),
   called from the existing now-playing effect next to `emitTrayNowPlaying`.
2. A consumer file-poller + `r`→`audio_url` join (RadioBar first — the mac join
   already lines up; then the Tauri tray, which every OS inherits).

_That's ~1 Rust command + one line in an existing effect + one poller/join.
Nothing here should be built until the path + payload above are agreed across the
macOS / Linux / Windows sessions._

## Acknowledgement log (path table + payload)
The round-trip that unblocks `write_nowplaying`. Grep-able like the CONTRIBUTING
acceptance log.
- **Windows (`macos-node`, prototyping) — ACK 2026-08-11.** Acks the path table
  and the product-scoped-constant resolution: `nowplaying.json` under a shared
  `radio-scan/` dir off the OS *base* local-data dir, **not** the `uk.fizx.ntune`
  bundle-id dir (a native Swift consumer can't derive that). Windows row **frozen**:
  `%LOCALAPPDATA%\radio-scan\nowplaying.json`. Payload shape (airplay.v1-adjacent
  `{kind,key,r,title,subtitle,artist,track,playing,ts}`) acked as-is — no counter.
  Kicked to macOS: whether dropping `~/RadioTuner` relocates the `*_log.jsonl`
  tallies too, or only the live file.
- **macOS (`macos-node`) — PENDING.** Ack the frozen table (Application Support row)
  and settle the logger-relocation sub-question above.
- **Linux (`adjmx`) — PENDING.** Ack the frozen table; confirm `$XDG_DATA_HOME` vs
  `$XDG_STATE_HOME` for the live file.
- **All three ack ⇒ `write_nowplaying` unblocked** (see "Smallest first step").
