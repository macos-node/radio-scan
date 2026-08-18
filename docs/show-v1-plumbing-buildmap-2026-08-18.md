# ntune — `show.v1` plumbing build map (publishing podcast follows)

> **Status: BUILD MAP — the contract is settled, the plumbing is not built.**
> The wire shape is decided and drafted at [`../schema/show.v1.json`](../schema/show.v1.json)
> (kind **31242**, two fixtures); this map is how ntune comes to speak it. It is the
> slice named at the end of **open decision #10** in the
> [v0.2.0 direction](./radio-scan-v0.2.0-direction-2026-08-10.md), which settled the
> kind number deliberately ahead of the code. It sits under the
> [L4 UI build map](./radio-scan-ui-2026-08-04.md) (U-milestone arc) and inherits its
> conventions. Suite-wide: **[SUITE.md](../SUITE.md)**.
>
> **This does not gate the 0.2.0 tag.** U4.5's harvest persistence is the minor's
> headline; this is a sibling slice that shares one prerequisite with it (S0).

Date: 2026-08-18 · current version **0.1.1-beta.4** · branch `main`

---

## Why this exists

Stations publish; podcasts don't. A followed station round-trips through the relays
(`station.v1`, read by `useStations`), while podcast subscriptions live in
`podcasts.json` + OPML and sync nowhere. That gap is not theoretical — it is *why*
two podcast feeds were published as `station.v1` on 2026-08-10 and had to be deleted
by hand on 2026-08-18: **"follow this stream" was the only publish button in the
app**. `publish_station` now refuses non-audio URLs, which closes the wrong door
properly; this map opens the right one.

**Done means:** following a show in ntune puts a `show.v1` on the relays, unfollowing
retracts it, and the Podcasts tab reads its own follows back the way the Stations tab
already does.

---

## What is already true (do not rebuild)

- **The contract.** `show.v1` = 31242, addressable, per-publisher; `d =
  airplay:show:<slug>`, required `name` + `r` (the **feed** URL), optional NIP-73
  `i` (`podcast:guid:<guid>`), `t`, `alt`. Harvest stays local — the event publishes
  the *follow*, not a copy of the feed's metadata.
- **Deletion semantics.** `deletion_tags(address, event_id)` already emits `a` **and**
  `e`, after 2026-08-18 measured `relay.fizx.uk` ignoring `a`-only deletions.
- **The publish-side guard.** `probe_content_type` + `non_audio_hint` exist and are
  unit-tested; this map adds the mirror-image check.
- **The durable stores.** `podcasts.json` (subs, with `latestAt`) and `feed-cache/`
  (bodies, conditional-GET refreshed) both landed 2026-08-18 and are verified on
  Linux + macOS.

---

## Phased build order

Each phase is independently useful and independently verifiable. Do not start a phase
before its predecessor's seam is stable.

### S0 — `podcast:guid` extraction  *(prerequisite; shared with U4.5)*

**The blocker this removes.** `feed-rs` 2.4 exposes **no extension map** — its `Feed`
struct has no `extensions` field, so `<podcast:guid>` is unreachable through the
parser ntune already uses. The `i` tag that `show.v1` names its *preferred* cross-user
key therefore needs its own extraction step, and without it every published follow
would be URL-only from day one.

- Extract the channel-level podcast-namespace `guid` from the raw feed bytes, which
  `fetch_podcast` already holds before parsing (`lib.rs`, the `bytes` binding).
- **Bind the namespace URI, not the `podcast:` prefix.** The prefix is convention;
  the URI is the spec. And scope it to the **channel**: `<guid>` inside an `<item>`
  is the *episode* id and must not be mistaken for it.
- `quick-xml` 0.41 is **already in `Cargo.lock`** (via feed-rs), so promoting it to a
  direct dependency adds no new supply chain.
- Surface as `Podcast.guid`, persist as `Sub.guid` (the field also becomes U4.5's
  podcast key — `podcast:guid` ‖ feed-url, per the direction doc's keying rule).
- **Deliverable:** a stable show identity that survives a feed moving host.
- **Verify:** the 2026-08-18 survey as a fixture-backed test — 4 of 6 sampled feeds
  carry a guid (podhome, yellowball, fountain.fm, nashownotes), 2 do not (the BBC's,
  and podbean's — *the show that motivated the contract*). Absent must stay absent,
  never an empty tag.

### S1 — Rust write path

- `publish_show(slug, name, url, guid, tags, description, relays)` → kind 31242 with
  `d`/`name`/`r`, `i` when a guid exists, `t` per topic, `alt`.
- `unfollow_show(slug, event_id, relays)` → kind:5 reusing `deletion_tags`, so `a` +
  `e` come free.
- Generalise `D_PREFIX` into per-kind constants (`airplay:station:` /
  `airplay:show:`) rather than threading a literal.
- **The inverse guard.** `publish_show` refuses a conclusively **audio** URL, exactly
  as `publish_station` refuses a feed — the same mistake in the other direction, and
  the pair of guards is what keeps `#r` honest per-kind. Same conclusive/inconclusive
  rule: no content-type or a failed probe passes.
- **Deliverable:** the app can put a show on the relays and take it off.
- **Verify:** unit-test the tag builder and the inverse guard against the
  content-types already measured; then one real publish read back with `nak`, and
  compared field-by-field against `schema/fixtures/show-31242.*.json`.

### S2 — Read path + the shared resolver

- `lib/show.ts` mirroring `lib/station.ts`: `SHOW_KIND`, `parseShow`, and the
  addressable resolve.
- **Extract, don't copy.** `resolveStations` encodes two subtleties that took a bug
  to get right — latest-delete-wins per address, and a re-publish *after* a deletion
  must not stay tombstoned. Pull them into a shared
  `resolveAddressable(events, kind, prefix, parse)` and have both kinds call it, so
  the NIP-09 logic has exactly one home.
- One subscription over `[31241, 31242, 5]` rather than a second pool.
- **Deliverable:** the app reads its own published shows back.
- **Verify:** the existing `station.test.ts` cases must pass unchanged through the
  extracted resolver — that is the regression proof for the refactor — plus the same
  cases for shows.

### S3 — Podcasts tab UI

- A **Follow** control per subscription, and unfollow through the existing confirm
  dialog, which gains the station dialog's "this also publishes a `kind:5`" wording
  when signed in.
- Merge the relay overlay with `podcasts.json` the way App merges stations, **deduped
  by guid ‖ url** (the U4.5 key). Note the local-wins/`eventId` carry-across lesson
  from the station merge: the local copy usually wins, so the relay twin's event id
  must be carried onto it or every unfollow goes out `a`-only.
- A chip for relay-sourced rows, in `--c-nostr` per the suite's publish-affordance
  rule — distinct from the existing `nostr` chip on npub-bridged feeds, which means
  something different (feed *served from* an npub, not *follow published to* relays).
- **Deliverable:** follows round-trip in the UI, on both tabs, by the same gestures.

### S4 — Verification + docs

- Linux + macOS runtime pass; real events diffed against the fixtures; CHANGELOG,
  STATUS, and the direction doc's decision #10 updated from *settled* to *built*.
- **Pace the relay probes.** macOS measured an unpaced 31-feed sweep drawing HTTP
  500s from fountain.fm and anchor.fm that read exactly like a cache bug and were
  only rate limiting. The same trap applies to any bulk publish test.

---

## Decisions taken in this map

- **Follow is explicit; import never publishes.** `AddStationDialog` auto-publishes a
  station on add when signed in. Copying that for podcasts would make an OPML import
  of 31 feeds fire 31 publishes in a burst — against exactly the hosts already
  observed rate-limiting a *read* sweep. Adding a subscription stays local; putting
  it on the relays stays a deliberate per-show act. This also keeps the two lists
  honestly different: a station list is small and curated, a podcast list arrives in
  bulk from other apps.
- **Slug collisions get a suffix.** `airplay:show:<slug>` is the addressable identity
  and two shows can slugify identically (stations avoided this by luck). Resolve at
  publish time against the local set: `-2`, `-3`, … Never silently replace another
  show's address.
- **Harvest is still not wire.** Tier-A identity persists locally per U4.5 and is not
  copied into the event, so `show.v1` stays small and "feed always wins" holds on the
  wire as well as in the store.

## Open questions (settle inside the slice)

1. **Does a show follow imply anything for `airplay.v1`?** An episode observation
   could reference its show by `#i`/`#r` or by the `a` coordinate, exactly as a
   station observation does today. Related to decision #4 (does L4 emit airplay at
   all) — note the seam, don't widen it here.
2. **Unfollow with no `eventId`.** A show followed on another machine, read back from
   a relay, then unfollowed — the id is known from the read, so this should be fine;
   confirm it holds when the row came from the relay overlay rather than a local add.
3. **What happens to a follow whose feed dies?** `castr.me/npub1e0f808a…` in the
   macOS profile 404s. A dead feed is still a legitimate follow — decide whether the
   UI marks it, and keep the event untouched either way.
