# radio-scan — build map & architecture sketch

> **Status: SKETCH / DIRECTION — NOT canonical, NOT built.** This is the map for
> turning the shipped standalone logger into an **n-suite** member under
> `github.com/macos-node/radio-scan`. It frames the architecture, a phased build
> order, and the decisions to lock. Suite-wide conventions are in
> **[SUITE.md](../SUITE.md)**; the wire-contract proposal is
> **[schema/airplay-design-2026-07-28.md](../schema/airplay-design-2026-07-28.md)**.
> Meant to be driven forward with Claude Code — treat the **Open decisions** as
> the worklist, not as settled.

Date: 2026-07-28

---

## What the user asked for

> "Could we sketch out a map for building a radio-scanner, to expand ndisc
> n-suite. This should become `macos-node/radio-scan` … if we have the notes
> prepared in the repo."

and, pivotally:

> "A pivotal idea would be that Nostr users could log in, share streaming
> information, relay information … publish these on Nostr, interact with events."

So the target is not just a personal logger. It is a **Nostr-native, social
airplay network**: people publish the streams they follow, publish what those
streams are playing, and discover / relay / react to each other's airplay — with
the personal 24/7 logger as the sensor that feeds it.

---

## The one-line role in the suite

**`ndisc` publishes what you _own_; radio-scan publishes what you (and others)
_hear_.** It is the suite's first *sensor* and its first *many-authors* surface:
where `ndisc` is single-owner-authoritative, airplay is inherently multi-user —
lots of npubs, each hearing their own stations, aggregating on the relays.

That makes radio-scan the natural proving ground for two things the SUITE.md
roadmap already wants but has deferred: **cross-user aggregation** (many people,
one shared view) and the **master-release-key** (grouping "the same work" across
users). Airplay needs both on day one, so build them here.

---

## Architecture — three layers

```
  ┌─────────────────────────────────────────────────────────────┐
  │  L3  SOCIAL / NETWORK   (Nostr)                               │
  │   • station registry events  (streams a user follows)        │
  │   • airplay observation events  (what a stream played)       │
  │   • reactions / feed notes  (interact with airplay)          │
  │   • cross-user aggregation off the relays  ("everyone's now") │
  └───────────────▲──────────────────────────────┬──────────────┘
                  │ signs w/ owner nsec (keyring) │ subscribes / reads
  ┌───────────────┴──────────────────────────────▼──────────────┐
  │  L2  SUITE BRIDGE                                            │
  │   • writes airplay.json into the shared suite dir           │
  │   • reconciles heard artist+title vs ndisc catalogue.json   │
  │   • publisher + poller (the only code that emits/reads events)│
  └───────────────▲──────────────────────────────┬──────────────┘
                  │ reads JSONL / summaries       │
  ┌───────────────┴──────────────────────────────▼──────────────┐
  │  L1  SENSOR CORE   (shipped today: radioscan.py)            │
  │   • ICY reader, multi-station, reconnect, per-station log   │
  │   • daily/weekly/overall summaries, station_info            │
  │   • launchd (macOS) / systemd (Linux) 24/7 service          │
  └─────────────────────────────────────────────────────────────┘
```

**L1 already exists and works** (this repo). L2 and L3 are the build. The key
architectural stance: **L1 stays headless and dumb** (log to disk), **L2 is the
only code that touches the suite dir and the relays**, and **L3 is a contract,
not an app** — any suite app (nplay, nview, glmps, a future radio-scan UI) can
read it.

---

## Phased build order

Each phase is independently useful and shippable. Do not start a later phase
before its predecessor's contract is stable.

### P0 — Sensor core  ✅ shipped
The standalone logger in this repo: `radioscan.py`, multi-station config,
launchd/systemd services, MusicBrainz enrichment helper, agent `SKILL.md`.
This is the reference implementation and the daemon. Nothing below replaces it.

### P1 — Suite bridge (local, no network yet)
- Resolve the **shared suite dir** exactly like the other apps
  (`suite_shared_dir()` / `suite_config_dir()` — see SUITE.md). Write an
  **`airplay.json`** (rolling aggregate: per-station, per-track counts +
  first/last heard) next to `published.json` / `catalogue.json`.
- **Reconcile** heard `artist + title` against `ndisc`'s `catalogue.json`:
  mark each heard track `matched` / `unmatched`, and expose "candidates"
  (unmatched, high play-count). This is the first genuinely suite-aware feature
  and needs no Nostr.
- Deliverable: the daemon writes suite-readable state; a heard-vs-owned view is
  possible in any app.

### P2 — Publish airplay to Nostr (single user)
- Implement L2 as the **publisher**: sign `airplay.v1` events with the owner
  `nsec` from the OS keyring (same key as ndisc). Emit a **station-registry**
  event (the streams this npub follows) and **airplay observations**.
- **Opt-in + aggregated by default** (privacy — see the schema doc). Start by
  publishing weekly heavy-rotation, not every track.
- Deliverable: `radio-scan` npub's airplay is on the relays, readable by glmps.

### P3 — The social layer (many users)
- **Read other users' registries + airplay**; subscribe to streams / npubs.
- **Cross-user aggregation**: "what's playing across everyone's stations right
  now", "most-relayed track this week" — filtered on the **master-release-key**
  so the same work groups across users and station metadata spellings.
- **Interact**: reactions (kind `7`, shared `lib/rating.ts`) and `feed.v1` notes
  on airplay. A user can co-sign / vouch a stream into a shared registry (reuse
  the `30000` contributor-registry + `4550` sign-off pattern).
- **Login paths**: local `nsec` (desktop/daemon), **NIP-46** bunker (mobile /
  nview), **NIP-07** (a future web reader) — mirror the suite's signing table.

### P4 — Surfaces (optional, parallel)
- **nplay**: a "Radio / Current" view — now-playing across followed stations,
  reusing its Current-feed reader.
- **nview / glmps**: airplay stats, heavy-rotation lists, a station directory.
- **radio-scan Tauri UI** *(only if warranted)*: browse stations, live tickers,
  matched/unmatched candidates → "add to ndisc". Adopts the shared design
  language verbatim. **Decide against P4-UI first** (see Open decisions) — the
  summaries + other apps may already cover it.

---

## Proposed repo layout (macos-node/radio-scan)

Keep P0 intact; grow around it. Mirror the ndisc repo's shape where it earns it.

```
radio-scan/
  README.md                       # standalone tool + pointer to suite docs (shipped)
  radio-scan-introduction.md      # suite identity (shipped)
  SUITE.md                        # vendored pinned copy of the hub (add)
  radioscan.py                    # L1 sensor core (shipped)
  config.example.json             # station config (shipped)
  service/                        # launchd + systemd (shipped)
  enrich/                         # MusicBrainz helper (shipped)
  skill/SKILL.md                  # agent skill (shipped)
  docs/
    radio-scan-buildmap-2026-07-28.md   # this file
    radio-scan-lockup.svg               # per-app lockup, when the mark exists
  schema/
    airplay-design-2026-07-28.md        # wire-contract proposal
    airplay.v1.json                     # drafted contract (proposal; kind 31240)
    station.v1.json                     # drafted contract (proposal; kind 31241)
    fixtures/                           # matched / unmatched / minimal + station example
  bridge/                         # L2 — suite dir + reconcile + publish/poll (P1–P3)
  src/  src-tauri/                # only if P4-UI is chosen (Tauri 2)
```

**Stack decision is deferred, not dodged:** L2/L3 can be written in **Python**
(fastest — reuse the working daemon, sign via a small Nostr lib) or **Rust** (to
match the suite and share a signer with ndisc). The map recommends **Python for
P1–P3 to move fast**, porting to Rust only if/when a Tauri UI (P4) makes a shared
Rust core worthwhile. Nothing in P1–P3 forces the choice except P4.

---

## Open decisions (the worklist)

1. **Suite codename.** Every suite app is `n*` (ndisc/nplay/ntree/nsmpl/nview/
   nping). The repo is `radio-scan` per the org, but does it get an n-alias for
   the suite roster — `ntune`, `nscan`, `nair`, `nwave`? *Recommend `ntune`;
   keep `radio-scan` as the repo/product name.*
2. **`airplay.v1` kind number + dedup window.** *Kinds locked for the proposal
   (2026-07-28): `airplay.v1 = 31240`, `station.v1 = 31241` — verified unused
   across the suite; drafted with fixtures in `schema/`.* Still open: the
   "same play" dedup window. See the schema doc.
3. **Matched vs unmatched model.** Radio gives `artist + title` only (no album).
   Does an observation carry a release `a`-ref + track locator (reuse
   `clip.v1`), an artist/track pair, or both? Align with the master-release-key.
4. **Privacy posture.** Aggregate weekly vs per-track; per-station opt-in;
   whether "currently playing" (real-time) is ever published or stays local.
   *Recommend: local by default; publish opt-in, aggregated first.*
5. **Registry authority.** Is a shared station registry owner-curated (like
   `30000` contributors + `4550` sign-off) or open (anyone publishes their own,
   discovery by follow)? *Recommend: personal registries + optional co-sign into
   a shared one — the suite already has that pattern.*
6. **Stack + P4-UI.** Python-through-P3 vs early Rust port; build a Tauri UI or
   lean on nplay/nview/glmps. *Recommend: Python to P3, decide UI after.*
7. **Cross-user aggregation = master-release-key.** Airplay is the first real
   consumer of the deferred shared-work key. Do we prototype the content-hash
   here (it needs the normalisation SUITE.md flags as open)?

---

## Why this is a good fit for the suite (not a bolt-on)

- It reuses, rather than reinvents: shared suite dir, the OS-keyring signer, the
  `7`/`30000`/`4550` social primitives, the `feed.v1` note shape, and the
  design language.
- It **advances the roadmap**: airplay is the concrete first user of cross-user
  aggregation and the master-release-key — the two big deferred items — so
  building it here de-risks them for `ndisc` too.
- It closes a loop `ndisc` can't: **discovery**. Today acquisitions come from
  Discogs/Bandcamp. Airplay adds "heard it on the radio → candidate for the
  shelf", with provenance source `radio`, feeding the catalogue the suite is
  built around.
