# radio-scan — airplay sensor & stream logger

> Part of the **n-suite**. Shared conventions, the Nostr wire contract, the
> design language, and the roadmap live in the hub doc **[SUITE.md](./SUITE.md)**
> (canonical copy in `ndisc`; vendor a pinned copy here). This file covers
> **radio-scan** specifically. The build plan is
> [`docs/radio-scan-buildmap-2026-07-28.md`](./docs/radio-scan-buildmap-2026-07-28.md);
> the proposed wire contract is
> [`schema/airplay-design-2026-07-28.md`](./schema/airplay-design-2026-07-28.md).

`radio-scan` is the suite's first **sensor**: where every other app acts on a
music library the owner already has, radio-scan watches the *outside* — internet
radio streams — and turns passive listening into structured data. It is the
inbound counterpart to `ndisc`'s outbound publishing: `ndisc` says "here is what
I own"; radio-scan says "here is what I heard."

It lives under the **`macos-node`** GitHub user (the macOS-side home, alongside
the `glmps` readers and the sites) because its natural form is a **headless
service that runs 24/7 on a Mac** — the same "run-X-on-macos" shape as
`run-lnd-on-macos`, not a windowed desktop tool. A Tauri UI is a later,
optional facet (see the build map), not the core.

## What it does
- **Reads the "Now Playing" metadata** Icecast/Shoutcast streams broadcast (the
  ICY `StreamTitle` — "Artist - Title" — read inline off the audio, exactly as a
  media player sees it), and logs every track change with a timestamp.
- **Logs many stations at once** from a config file; reconnects on drop; decodes
  UTF-8 / cp1251 / Latin-1 so non-English and Cyrillic titles survive.
- **Rolls up airplay stats** — per-station daily / weekly / all-time summaries:
  rotation size, most-played tracks and artists, repeats, activity by hour.
- **(planned) Reconciles against `ndisc`** — matches heard `artist + title`
  against the owner's catalogue to answer "do I own this?" and surface
  candidates ("heard 12× on acidjazz, not in the library").
- **(planned) Publishes airplay observations to Nostr** as a new
  `airplay.v1` kind, so `nplay` / `nview` / `glmps` can render "what my stations
  are playing" and heavy-rotation stats.

## Tech stack & build
**Reference core (today):** single-file **Python 3, standard library only** — the
proven logger this repo ships with (`radioscan.py`). It is the daemon core and
stays the fast path.

**Suite-facing form (planned):** the daemon writes into the **shared suite
directory** (`airplay.json` alongside `published.json` / `catalogue.json`), and a
**Nostr publisher** signs observations with the owner `nsec` from the OS keyring.
Two open stack decisions in the build map: (1) keep the Python daemon vs. port
the reader to **Rust** to match the suite, and (2) whether a **Tauri 2 · React ·
TypeScript** UI is worth it over reading the summaries directly. Install as a
service: **launchd** on macOS, **systemd** on Linux (both shipped).

## Suite integration
- **Produces (planned):** `airplay.v1` — airplay observations (station · artist ·
  title · first-heard · play-count · optional release `a`-ref + track locator
  when matched). Proposed contract in `schema/airplay-design-2026-07-28.md`.
- **Consumes (planned):** `ndisc`'s `catalogue.json` (and/or `release.v2` off the
  relays) to reconcile heard tracks against owned releases — provenance source
  `radio`, reusing the `clip.v1` track-locator idea and the master-release-key
  normalisation from the suite roadmap.
- **Read by (planned):** `nplay` (a "Radio / Current" now-playing view), `nview`
  / `glmps` (airplay stats and heavy-rotation lists). Optionally emits `feed.v1`
  notes ("heavy rotation this week") and `7` reactions like the other apps.
- Vendors the shared `schema/` contracts; adds one new one it authors.

## Nostr surface
Proposed **producer** of two new kinds — `airplay.v1` (**31240**) and
`station.v1` (**31241**), locked for the proposal and drafted with fixtures in
`schema/` (see the schema design). Signs with the **same owner `nsec`** as `ndisc` / `ntree` /
`nsmpl` (one person = one `npub`), held in the OS keyring. Keeps
`relay.fizx.uk` in its relay set as the discovery hub. Publishing is
**opt-in and aggregated** by default — see the privacy note in the design doc,
since airplay reveals listening habits in a way the catalogue does not.

## Styling notes
No in-app UI yet. When one exists it adopts the shared design language verbatim —
the fizx palette `--c-*` tokens (never hardcoded hexes), the two themes,
Helvetica UI / monospace for numbers and IDs, squared corners, the
collapse-flanks layout, and the mono-first **dot colour model** (a station reads
as a *named source* in the `lib/source.ts` sense — an airplay analogue of the
acquisition-source dot). Leaf-dots map naturally to "matched vs unmatched against
the catalogue."

## Backlog & direction
- Firm up the `airplay.v1` contract (kind number, dedup window, the
  matched/unmatched split) and promote it from unfrozen to SHA-pinned once
  radio-scan first emits it — the same freeze discipline as `clip.v1`.
- Reconciliation model: heard `artist + title` → release match is the hard part
  (radio gives no album); align it with the suite's **master-release-key**
  content-hash direction rather than inventing a second matcher.
- The privacy posture for publishing airplay (aggregate vs per-track; per-station
  opt-in).
- See **[the build map](./docs/radio-scan-buildmap-2026-07-28.md)** for the
  phased plan and the open decisions to lock with Claude Code.
