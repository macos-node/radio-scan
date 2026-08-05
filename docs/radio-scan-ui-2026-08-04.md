# radio-scan — L4 UI build map (the tuner / player / listening surface)

> **Status: SKETCH / DIRECTION — NOT canonical, NOT built.** This is the map for
> the **L4 desktop UI** that the [P0–P4 build map](./radio-scan-buildmap-2026-07-28.md)
> reserved as an optional facet. It **resolves Open decision #6** of that map in
> favour of building the UI — and reframes it: not the "stats browser" P4 sketched,
> but a **tuner + player + subscription library**. This is the first thing in the
> repo that actually *listens* (the L1 sensor deliberately discards audio).
> Suite-wide conventions: **[SUITE.md](../SUITE.md)**. Wire contract:
> **[schema/airplay-design-2026-07-28.md](../schema/airplay-design-2026-07-28.md)**.
> Meant to be driven forward with Claude Code — treat the **Open decisions** as
> the worklist, not as settled.

Date: 2026-08-04 · supersedes the P4-UI stance of the 2026-07-28 map (which
recommended *deciding against* a UI first) · suite alias proposal: **`ntune`**

---

## What the user asked for

> "What would it take to build a Tauri … desktop app … based on RSS feeds,
> primarily … nostr npubs as feeds … [and] stream-based [radio]. Perhaps
> stream-based and audio/podcast rss should go together?"

and, on where it lives:

> "Become radio-scan's Tauri UI" — a **radio-first** app: the listening front-end
> to the airplay graph, with podcast RSS and per-npub audio feeds bolted on as
> secondary source tabs.

So L4 is the **consumer/player** counterpart to L1's sensor. L1 answers *"what is
this station playing?"* and discards the bytes; **L4 opens the same stream and
lets you hear it**, shows the now-playing label, and lets you follow, react, and
subscribe. It also closes the loop the sensor can't on its own: **a human pressing
play.**

---

## The one-line role in the suite

**L1 logs what *plays*; L4 handles what *you follow, tune into, and listen to*.**
Where the sensor is headless and many-observers, the UI is single-user and
interactive — it is the airplay graph's *reader*, and the only place a "follow"
(a `station.v1`) is authored by a person rather than inferred by a daemon.

It is also the suite's **first networked-audio player**. `nplay` plays *local*
files (and had to route them through Rust rodio because WebKit2GTK can't play
local app-URI audio). L4 plays *remote HTTP* audio — radio streams, podcast
enclosures, `1063` files — which the webview `<audio>` element handles directly
(`ntree`'s `AudioPlayer.tsx` already proves this on the same GTK/X11 stack). So
L4 is a *lighter* playback problem than nplay, not a heavier one.

---

## Architecture — the layer the map reserved

```
  ┌─────────────────────────────────────────────────────────────┐
  │  L4  TAURI UI   ◀── this doc  (alias: ntune)                 │
  │   • TUNE a station.v1 stream and LISTEN (webview <audio>)    │
  │   • FOLLOW a station  → PUBLISHES station.v1 (keyring nsec)  │
  │   • NOW-PLAYING via a Rust loopback ICY proxy (see below)    │
  │   • airplay stats + matched/unmatched dots + react (kind:7)  │
  │   • SECONDARY tabs: podcast RSS (feed-rs) · per-npub 1063    │
  └───────────────▲──────────────────────────────┬──────────────┘
   reads L2 state │ publishes station.v1          │ consumes L3 events
  ┌───────────────┴──────────────────────────────▼──────────────┐
  │  L3  Nostr contracts  airplay.v1(31240) · station.v1(31241) │
  ├──────────────────────────────────────────────────────────────┤
  │  L2  suite bridge     airplay.json · ndisc reconcile · poller│
  ├──────────────────────────────────────────────────────────────┤
  │  L1  python sensor    radioscan.py — 24/7 ICY logger (untouched)
  └─────────────────────────────────────────────────────────────┘
```

**Architectural stance.** L4 does **not** replace or absorb L1–L3; it consumes
them. Two seams are new and must be written down:

1. **`station.v1` becomes a UI-authored event.** "Follow this station" is a human
   act, so L4 signs and publishes `station.v1` (31241) with the owner `nsec` from
   the OS keyring — the same signer/pattern as `ndisc`/`ntree`/`nsmpl` (one person
   = one npub). **`airplay.v1` (31240) stays L2/Python** — only the sensor knows
   what actually played. (Exception to resolve: see Open decision #4, "does the UI
   emit airplay when *it* is the listener?")
2. **Now-playing has two possible sources** — the local ICY proxy (below) when
   you're tuned in, and `airplay.v1` off the relays for stations a *remote* sensor
   watches but you aren't playing. L4 prefers the local proxy, falls back to the
   relay observation. (Open decision #5.)

---

## The key mechanism: one Rust loopback that is *both* player and sensor

Playing a radio stream in the webview *and* showing now-playing hits a wall:
WebKit2GTK's `<audio>` plays a remote URL fine but **won't surface ICY
`StreamTitle` to JS**. The fix unifies two things the repo/suite already own:

- **`nplay`'s loopback pattern** — a `127.0.0.1` server that feeds the webview.
- **`radioscan.py`'s ICY reader** — the `Icy-MetaData: 1` / `icy-metaint` /
  `StreamTitle` parser (with the UTF-8 → cp1251 → Latin-1 decode ladder).

Port that parser to Rust as a **loopback proxy inside `src-tauri`**:

```
 upstream stream ──(Icy-MetaData:1)──▶  Rust proxy  ──clean audio──▶ 127.0.0.1:PORT
                                          │                              │
                                          │ strips metadata blocks       ▼
                                          └─ emit StreamTitle ───▶  Tauri event ──▶ <audio src=…:PORT>
                                             as a Tauri event         (frontend now-playing label)
```

Payoff:

- **Now-playing works locally and offline-of-the-sensor** — no dependency on a
  remote daemon being up, no relay round-trip.
- The **same ICY contract runs in L1 (Python) and L4 (Rust)** — port the parser
  once; it becomes the shared reference, and the Rust version is a candidate to
  back-port into a future Rust L2.
- **No rodio needed** for playback — the webview plays the proxied stream
  directly. rodio/symphonia (nplay's stack) is pulled in **only** if a spectrum
  visualiser or gapless is later wanted (Open decision #3).

---

## Why radio + podcast + npub genuinely fit one app

The three sources collapse together in *this* suite for a concrete reason: each is
**remote HTTP audio behind a source identity the suite already models**, and the
episodic-vs-continuous split is a `SourceType` enum, not a second codebase.

| Source | Identity / discovery | Refresh | Yields | Reuse |
|--------|----------------------|---------|--------|-------|
| **Radio stream** | `station.v1` `r` tag (relay-filterable `#r`) | none — live | one perpetual item | L2/L3 + ICY proxy |
| **npub audio** | followed npub → `1063` (NIP-94) | live sub / poll | synthesized episodes | `ntree` relay + `AudioPlayer` |
| **Podcast RSS** | feed URL | poll interval | episode list (seekable, resumable) | `feed-rs` (new) |

Radio-first means the spine is the tuner; feeds are secondary tabs. But all three
share one player, one library table, and the dot-colour **source model**
(`lib/source.ts`) the intro already earmarks — a station reads as a *named source*
exactly like an acquisition-source dot, and matched/unmatched maps to leaf-dots.

---

## Phased build order (L4 only; L1–L3 proceed on their own map)

Each phase is independently useful. Do not start a phase before its predecessor's
seam is stable.

### U0 — Scaffold + tune & listen  *(no Nostr, no proxy)* — ✅ done
- Tauri 2 + React 19 + TS + Tailwind v3, `make dev`/`make install`/`make check`,
  `~/.local` install, the shared `--c-*` design tokens (never hex), squared
  corners, Helvetica-UI / mono-for-IDs, collapse-flanks layout, `shortVersion()`
  header chip. Nostr/publish affordances use `--c-nostr`, not `--c-mauve`.
- Read a **static station list** (seed from `config.example.json` +
  `schema/fixtures/station-31241.example.json`) and **play a raw stream URL via
  the webview `<audio>` element**. Play / stop / volume / station switch.
- **Deliverable:** a working internet-radio player on the suite's stack. Proves
  remote-HTTP playback with zero Rust audio code.

### U1 — Station library from `station.v1` — ✅ done
- Subscribe to `station.v1` (31241) off the relays (own follows first), keeping
  `relay.fizx.uk` in the set. Render the **station directory** with the source-dot
  model; hydrate `name`/`fmt`/`br` from tags. Reuse the ndisc/ntree relay client.
- **Deliverable:** the tuner's station list *is* the Nostr registry, read-only.
- *As built:* `lib/station.ts` (pure parse/resolve) + `hooks/useStations.ts`
  (`SimplePool`), reads `ownerHex`'s stations, seed fallback until any exist.

### U2 — Follow = publish `station.v1`  *(first write path)* — ✅ done
- Add/follow/edit a station → sign & publish `station.v1` with the keyring `nsec`
  (mirror `ntree`'s publish flow and `useReactions` signer). Parameterised-
  replaceable `d` = `airplay:station:<slug>`, URL in the `r` tag.
- **Deliverable:** following a station in the UI puts it on the relays for others
  to discover — L4 is now the registry's author.
- *As built:* keyring identity in Rust (`get/generate/import/clear_identity`,
  own `ntune`/`ntune-dev` service, mirrors ntree) + `publish_station` (31241) and
  `unfollow_station` (NIP-09 kind:5). The read filter uses the **signed-in
  pubkey** (fallback to the suite owner), so publish + read stay self-consistent;
  the live subscription reads a new station straight back in. Header gains an
  identity chip + Follow button; rows get a hover ✕ to unfollow.

### U3 — Now-playing via the loopback ICY proxy
- Implement the Rust loopback proxy (port `radioscan.py`'s ICY parser →
  `src-tauri/src/icy.rs`); stream StreamTitle to the frontend as Tauri events.
- Show the airplay panel: `airplay.v1` stats (plays, first/last heard),
  **matched/unmatched** vs `ndisc` `catalogue.json` as leaf-dots, kind-`7`
  reactions (shared rating lib). Fall back to relay `airplay.v1` when not tuned in.
- **Deliverable:** tune in → see what's playing, whether you own it, and react.

### U4 — Feeds bolt-on: podcast RSS + per-npub `1063`
- **Podcast tab:** subscribe by URL, `feed-rs` (Rust) parses RSS 2.0 + `podcast:`
  namespace → episode rows in SQLite (WAL, suite convention); resume positions.
  OPML import; optional castr.me-style **RSS *export*** of an npub's audio timeline.
- **Nostr-feeds tab:** per followed npub, read `1063` (+ optionally kind-1 audio
  links, the castr.me heuristic) → episodes. Reuse `ntree`'s `FeedPanel`/`1063`
  reader rather than reinventing it.
- **Deliverable:** one library, three source types, resume-anywhere playback.

### U5 — Polish *(optional, parallel)*
- Spectrum visualiser (triggers the rodio path — decide in #3); gapless;
  NIP-46 bunker login parity (mirror the suite signing table); `feed.v1` notes
  ("heavy rotation this week"); "heard it → add to ndisc" candidate action.

---

## Repo layout delta (grows around P0)

The L4 app nests under **`gui/tauri/`** — sibling to the existing `gui/macos/`
(Swift `RadioBar`), keeping the Python sensor's repo root clean. (This refines
the prior map, which sketched root-level `src/ src-tauri/` before `gui/` existed.)

```
radio-scan/
  …                               # L1 sensor + schema + service (untouched)
  bridge/                         # L2 — python, per the P1–P3 map
  gui/
    macos/                        # Swift RadioBar menubar app (shipped)
    tauri/                        # L4 — the ntune app  ◀── scaffolded at U0
      src/                        # React UI
        lib/{tauri,cn,format}.ts  # + later: {source,relay,rating,audio}.ts
        components/{StationList,PlayerBar,ToolbarIconButton}.tsx
                                  # + later: {NowPlaying,PodcastTab,NostrFeedTab}.tsx
      src-tauri/
        src/lib.rs                # seed_stations (U0)
                                  # + later: icy.rs, loopback.rs, publish.rs
        Cargo.toml                # tauri+serde at U0; nostr-sdk/tiny_http/feed-rs reserved
      Makefile  index.html  tailwind.config.ts  …   # standard Tauri-2 shell
  docs/
    radio-scan-ui-2026-08-04.md   # this file
```

Suite conventions honoured by the scaffold: `--c-*` design tokens (three themes:
fizx / upleb / mono) with a theme-neutral `--c-nostr`; the `shortVersion()`
header chip; `make dev`/`install`/`check`/`icons`; `~/.local` install; identifier
`uk.fizx.ntune`. **Playback at U0 is the webview `<audio>` element on the remote
stream URL — no Rust audio backend** (confirmed: the asset-protocol limitation
nplay routes around is local-file-only; remote HTTP plays directly).

**Cross-platform note.** The repo's *home* is `macos-node` because the **sensor**
is a run-24/7-on-a-Mac service — but L4 is a Tauri app **developed here on Linux**
and built for both. The repo becomes polyglot (Python daemon · Rust/TS Tauri ·
Swift `RadioBar`). That's fine; it just means the sensor and the UI need not run on
the same machine — which is *why* the local ICY proxy (U3) matters and why L4 also
reads `airplay.v1` off the relays.

---

## Open decisions (the worklist)

1. **`RadioBar` (Swift menubar) fate. — RESOLVED (2026-08-05).** RadioBar stays
   the **macOS-native** menubar option; the **cross-platform** answer is a
   **Tauri tray mode in ntune** (Tauri's tray API covers Linux/macOS/Windows —
   Swift can't). The tray/now-playing surface becomes a post-`v0.1.0` arc:
   ntune grows a tray showing now-playing (fed by U3's ICY proxy), which is also
   the natural `airplay.v1` emission point → the suite's menubar
   now-playing/scrobbler pattern (ntune + nplay + the logger). Direction:
   [`../gui/tauri/docs/menubar-companion-2026-08-04.md`](../gui/tauri/docs/menubar-companion-2026-08-04.md).
   Sequence: **U3 → tray companion → `airplay.v1`**.
2. **Repo home vs dev machine.** Stays `macos-node/radio-scan` (sensor identity);
   L4 builds/runs cross-platform, developed on Linux. *Recommend: confirm as-is;
   no split.*
3. **Playback engine.** Webview `<audio>` (recommended: zero Rust audio, ntree-
   proven) vs rodio/symphonia from day one (needed only for a spectrum/gapless).
   *Recommend: `<audio>` through U4; add rodio only if U5 spectrum is wanted —
   note Web Audio is muted on this stack, so a visualiser forces the rodio tap.*
4. **Does L4 emit `airplay.v1` when *it* is the listener?** The U3 proxy makes the
   UI a de-facto sensor. Keep "L2/Python is the sole `airplay.v1` publisher" and
   have L4 hand observations to the bridge, or let L4 publish its own (opt-in)?
   *Recommend: L4 writes to `airplay.json`/bridge, one publisher — revisit if the
   UI runs standalone without the daemon.*
5. **Now-playing source of truth.** Local proxy ICY vs relay `airplay.v1` vs both
   (proxy when tuned, relay otherwise). *Recommend: both, proxy preferred.*
6. **Suite alias.** Prior map recommended **`ntune`** (keep `radio-scan` as repo/
   product name). Adopt it for the L4 window title + roster line? *Recommend: yes.*
7. **npub-audio scope.** `1063` only (clean, suite-native) or also kind-1 audio
   links (the castr.me heuristic, covers arbitrary npubs)? *Recommend: `1063`
   first, kind-1 as an opt-in "scan notes for audio" toggle.*
8. **L2 stack revisited.** The prior map deferred Python→Rust "only if a UI makes a
   shared Rust core worthwhile." U3's Rust ICY parser + U2's Rust signer *are* that
   shared core — does that now pull the L2 publisher toward Rust, or stay Python?
   *Recommend: leave L2 Python for now; the Rust ICY parser is the first shared
   piece, port more only if duplication bites.*

---

## Why this is a good fit (not a bolt-on)

- **Fills a reserved slot** — the P0–P4 map already drew `src/ src-tauri/` and an
  "only if warranted" UI; this resolves that decision and specifies it.
- **Reuses, doesn't reinvent** — the keyring signer, `station.v1`/`airplay.v1`
  contracts, the `7`/`feed.v1` social primitives, `ntree`'s relay + `1063` reader
  and `AudioPlayer`, `nplay`'s loopback pattern, `radioscan.py`'s ICY parser, and
  the design language verbatim.
- **Closes the human loop** — the sensor observes; the UI lets a person *tune in,
  follow, react, and subscribe*. It turns the airplay graph from a dataset into a
  place you listen — and unifies radio, podcasts, and npub audio under one player
  because, in this suite, they are all the same thing: remote audio behind a
  Nostr-addressable (or RSS) source.
