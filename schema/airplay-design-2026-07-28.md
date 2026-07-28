# `airplay.v1` + `station.v1` — wire-contract proposal (design note)

> **Status: PROPOSAL / basic spec — NOT canonical, NOT built, NOT frozen.**
> Sketches the two new Nostr events radio-scan would author for the **n-suite**:
> a **station registry** (streams a user follows) and an **airplay observation**
> (what a stream played), plus how users **interact** with them. Non-authoritative
> until radio-scan first emits it, at which point it is promoted to a SHA-pinned
> contract like `release.v2` / `clip.v1`. Suite contract rules: **[SUITE.md →
> The Nostr wire contract](../SUITE.md)**. Build context:
> **[docs/radio-scan-buildmap-2026-07-28.md](../docs/radio-scan-buildmap-2026-07-28.md)**.

Date: 2026-07-28 · kinds **LOCKED for the proposal** — airplay.v1 = **31240**,
station.v1 = **31241** · freeze **deferred**

> The precise wire shapes now live as drafted contracts with fixtures:
> [`airplay.v1.json`](./airplay.v1.json), [`station.v1.json`](./station.v1.json),
> and [`fixtures/`](./fixtures/). Snippets below are illustrative; those files are
> authoritative for the proposal.

---

## What the user asked for

> "Nostr users could log in, share streaming information, relay information …
> publish these on Nostr, interact with events."

Two things go on the wire: **the streams** (so others can discover and follow
them) and **the airplay** (what those streams are playing). Reactions and feed
notes then let users *interact* with airplay. All three reuse existing suite
primitives; only two new event kinds are introduced.

---

## The events

| Kind | Name | NIP | Role | Signed by | `d` identity |
|------|------|-----|------|-----------|--------------|
| `31241` | `station.v1` | 33 | A stream a user **follows** (url + metadata) | any user | `airplay:station:<slug>` |
| `31240` | `airplay.v1` | 33 | An **airplay observation** for a station+track | any user | `airplay:<station>:<mrkhex>` |
| `7` | reaction | 25 | React to / rate an airplay or station | any user | — |
| `31239` | `feed.v1` | 33 | A note *about* airplay ("heavy rotation…") | owner + contributors | `glmps:<id>` |
| `30000` | registry | 51 | Optional **shared** curated station set | owner | `airplay:stations` |
| `4550` | sign-off | 72 | Vouch a station into the shared registry | owner | — |

> **Kinds locked for the proposal.** Confirmed unused across the suite (the used
> set is `1063 / 4550 / 27235 / 30000 / 31237 / 31238 / 31239`): `airplay.v1 =
> 31240` and `station.v1 = 31241`, kept contiguous with the suite's `31237–31239`
> block rather than the NIP-78 `30078` range (so both airplay and station are
> addressable and #d/#a-discoverable in the same family). Final confirmation is a
> merge-time check, not a freeze commitment.

Everything is **parameterised-replaceable** (33/30xxx) so re-publishing the same
`d` updates in place — an observation's play-count grows, a station's metadata is
corrected, without event spam.

### `station.v1` — a followed stream

```json
{
  "kind": 31241,
  "tags": [
    ["d", "airplay:station:acidjazz"],
    ["name", "Acid Jazz"],
    ["r", "http://79.111.14.76:8000/acidjazz"],
    ["fmt", "audio/aacp"], ["br", "320"],
    ["server", "Icecast 2.4.0-kh4"],
    ["t", "acid-jazz"], ["t", "funk"],
    ["alt", "A radio stream followed in radio-scan"]
  ],
  "content": "Optional human description of the station."
}
```

The stream URL is carried in the single-letter **`r`** tag so it is
relay-filterable (`#r`) — the cross-user station identity.

The registry carries **no airplay** — just the stream identity, so anyone can
discover and follow it. `station_info.txt` (already captured by the sensor)
populates `fmt` / `br` / `server`.

### `airplay.v1` — an observation

An observation is **per station + per track**, replaceable, and its play-count
accretes. It carries `artist + title` (all radio gives), a **match** to an
`ndisc` release when one is found, and timing.

```json
{
  "kind": 31240,
  "tags": [
    ["d", "airplay:acidjazz:d5ea7d4c9bd7dae04b4e13dba6ad15f3"],
    ["artist", "Dana Bryant"],
    ["title", "Heat"],
    ["plays", "12"],
    ["first_heard", "1785248099"],
    ["last_heard", "1785331200"],
    ["r", "http://79.111.14.76:8000/acidjazz"],
    ["a", "31241:<ownerhex>:airplay:station:acidjazz"],
    ["a", "31237:<ownerhex>:disco-vault:314"],
    ["mrk", "master:d5ea7d4c9bd7dae04b4e13dba6ad15f3"],
    ["track", "3"], ["disc", "1"],
    ["alt", "Heard on Acid Jazz radio"]
  ],
  "content": ""
}
```

- **`d` suffix (`<mrkhex>`)** — the 32 hex of the master-release-key (the `mrk`
  value without `master:`), so the same track has one stable, replaceable
  observation per station. The normalisation is the **same** one that feeds the
  master-release-key (SUITE.md flags it as the open question — do it once, here).
- **`r`** — the stream URL (relay-filterable `#r`): cross-user station identity.
- **station `a`** (`31241:…`) — the author's own `station.v1`, for metadata
  hydrate.
- **`mrk`** — the **master-release-key** (content-derived), so airplay of "the
  same work" groups across users and across stations even when title spellings
  differ. This is airplay acting as the first real consumer of that deferred
  suite idea.
- **`a` + `track`/`disc`** — present only when reconciled against the owner's
  catalogue; reuses the **`clip.v1`** release-`a`-ref + track-locator shape.
  Absent ⇒ **unmatched** ⇒ a discovery candidate.

### Interaction
Reactions (`7`) target an `airplay.v1` or `station.v1` by `a`-coordinate, using
the shared `lib/rating.ts` aggregation — identical to how clips/samples are
rated. A `feed.v1` note can `a`-ref an airplay observation to comment on it
("heavy rotation this week on acidjazz"). Nothing new is needed for interaction;
it falls out of the existing `7` / `31239` primitives.

---

## Truth & authority (suite framing)

Consistent with SUITE.md's two-authorities model:

- **Relays are the network truth.** No node is authoritative over "what is being
  heard across the network" — it reconciles off the relays, exactly like release
  discovery. Cross-user aggregation is a *read*, never an owned table.
- **radio-scan is schema authority** for `airplay.v1` / `station.v1` (it owns the
  shape in `schema/`), nothing about network state — mirroring "ndisc is the
  contract authority" for its kinds.
- **One key per person.** Airplay signs with the same owner `nsec` as the rest of
  the suite, so "my airplay" reconciles under one npub. `relay.fizx.uk` stays in
  the read set as the discovery hub.

---

## Privacy (the one genuinely new concern)

Airplay is **not** like the catalogue: it reveals *listening habits in real
time*. So, unlike `release.v2`, publishing is **off by default**:

- **Local-only** is the default; the sensor logs to disk and the suite dir, and
  publishes nothing until the user opts in.
- **Opt-in, aggregated first.** The first thing worth publishing is weekly
  heavy-rotation per station, not a live per-track ticker.
- **Per-station opt-in.** A user may share airplay for one station and not
  another.
- **Real-time "now playing"** on the wire is a separate, later, explicit choice —
  never implied by enabling aggregate sharing.

This posture is part of the contract, not a UI afterthought: an `airplay.v1`
event only exists because the user chose to emit it.

---

## Freeze plan

`airplay.v1` and `station.v1` start **unfrozen** (no SHA pin), like `labels.v1`
and `clip.v1` were. Each is promoted to **frozen, SHA-256-pinned in `schema/`**
the moment radio-scan first emits it in a release, after which changes are
**additive-only** and any change is a **coordinated wave** across every consumer
(nplay / nview / glmps). Two version axes apply as everywhere: radio-scan's own
semver *and* the shared `contract.vN` SHA.

---

## Open questions (do not guess)

1. **Kind numbers — LOCKED for the proposal (2026-07-28).** `airplay.v1 = 31240`,
   `station.v1 = 31241`, verified unused across the suite. A shared *curated*
   station registry, if built, reuses the existing `30000` set + `4550` sign-off.
   Re-confirm at merge time only.
2. **`<trackkey>` / `mrk` normalisation.** The exact normalisation (case,
   punctuation, `feat.`, remix suffixes, `&` vs `and`) is *the* hard problem and
   is shared with the master-release-key — specify it once, test with fixtures
   (mirror `schema/fixtures/`).
3. **Matched-only vs always-publish.** Do we publish unmatched airplay (pure
   `artist+title`), or only once reconciled to a release? Leaning: publish both,
   `matched` flag via presence of `a`.
4. **Aggregation granularity.** Per-station-per-track replaceable (this draft)
   vs periodic digest events. Replaceable keeps event count bounded; digests
   give a cleaner history. Decide before freeze.
5. **Station identity across users.** Two users following the same URL should
   converge on one station key — normalise on URL? on a hash of URL? Handle
   redirects / playlist wrappers (`.m3u`/`.pls` → real mount).
