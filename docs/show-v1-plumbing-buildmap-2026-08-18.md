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

### S4 — Verification + docs  *(in progress)*

- Linux + macOS runtime pass; real events diffed against the fixtures; CHANGELOG,
  STATUS, and the direction doc's decision #10 updated from *settled* to *built*.
- **Pace the relay probes.** macOS measured an unpaced 31-feed sweep drawing HTTP
  500s from fountain.fm and anchor.fm that read exactly like a cache bug and were
  only rate limiting. The same trap applies to any bulk publish test.

#### ✅ First live publish — 2026-08-19, Linux

The operator followed **No Agenda Show** from the installed build. Event
`ad61c99d639b347e37f1e540ebcd55344f34ce304029d48127755a25d93347a6`, `created_at`
2026-08-19 10:18, present and **identical on all three relays** (`relay.fizx.uk`,
`nos.lol`, `relay.primal.net`).

Read back with `nak` and diffed tag-by-tag against
[`../schema/fixtures/show-31242.guid.json`](../schema/fixtures/show-31242.guid.json):

| tag | live event | vs fixture |
|-----|------------|------------|
| `d` | `airplay:show:no-agenda-show` | identical |
| `name` | `No Agenda Show` | identical |
| `r` | `http://feed.nashownotes.com/rss.xml` | identical |
| `i` | `podcast:guid:856cd618-7f34-57ea-9b84-3600f1f65e7f` | identical |
| `alt` | `A podcast followed in radio-scan` | identical |
| `t` | *(absent)* | fixture has `talk` — see below |

**What this proves end to end.** The `i` value equals the guid read directly off
nashownotes' feed with `curl` on 2026-08-18, *before the extractor existed*. So the
whole chain is confirmed against an independently-known value: `quick-xml`
extraction → `Podcast.guid` → `Sub.guid` in `podcasts.json` → NIP-73 tag on a
signed event → three relays.

**The discovery claim is measured, not asserted.** A `#i` filter with **no author**
returns the event on both `relay.fizx.uk` and `nos.lol` — any client can ask "who
follows this show?" by Podcasting-2.0 guid, across users, and the relay answers.
`#r` resolves it too, the fallback for feeds that state no guid. This is the
property that justified a separate kind instead of overloading `station.v1`, and it
now holds on live relays rather than only in the contract.

**The one difference is a real (small) open item.** The fixture carries `t: talk`;
nothing publishes `t` tags because S3 ships no topic input. Decide in this phase:
add a topic control, or drop `t` from the fixture. As it stands the fixture
documents an optional capability the UI does not expose — harmless on the wire,
misleading as documentation.

#### ✅ First live unfollow — 2026-08-19, Linux · *and the `e`-tag fix confirmed*

The operator unfollowed the show minutes after publishing it. Deletion
`b85b4216a2a2`, on all three relays, carrying **both** NIP-09 targets:

```
a: 31242:916c25cf…:airplay:show:no-agenda-show
e: ad61c99d639b347e37f1e540ebcd55344f34ce304029d48127755a25d93347a6
```

All three relays then served **zero** `show.v1` events, and the `#i` discovery
filter returned nothing — another client looking for followers of that guid
correctly finds none.

**`relay.fizx.uk` honoured this deletion.** That is the question left open on
2026-08-18, and the same session provides its own control group: the 7 stations
deleted with `a`-only tags on 08-06/08-18 are *still being served* by that relay.

| relay | stations (`a`-only deletes) | this show (`a` + `e`) |
|-------|----------------------------|------------------------|
| `relay.fizx.uk` | **5 still served** | **0 — dropped** |
| `nos.lol` | 0 | 0 |

Same relay, same author, same day. The only variable is the `e` tag. That turns
the 2026-08-18 inference into a measurement, and validates commit `24c874d` on live
infrastructure rather than in a unit test. (5 rather than 7 is the
addressable-replaceable count collapsing duplicate `d` values.)

**Two consequences beyond this slice:**

1. **`e` is required in practice, not optional**, for anything published to
   `relay.fizx.uk` — the suite's own discovery hub. Any future kind that supports
   retraction should tag both targets from day one. This belongs in the schema
   conventions, not only in `unfollow_station` / `unfollow_show`.
2. **The 5 station tombstones are still live on the hub.** ntune filters them
   client-side (`resolveAddressable`) so no user sees them, but any other client
   reading that relay does. They clear only by re-following and re-unfollowing each
   with the current build, or by fixing NIP-09 support server-side (root there is
   macOS-only).

#### ✅ macOS pass + the read-back bug it exposed — 2026-08-19

macOS followed *The Peter McCormack Show* (`de61654e9d48…`, all three relays) and
found what neither Linux run could: **a follow published mid-session did not mark
its own row** — the chip stayed `follow` until restart. The pure layer was cleared
first by replaying the live event and a real 25-sub store through
`parseShow → resolveShows → mergeFollows`; the gap was S3's design choice that
`follow()` keeps no local state and waits for the open subscription to hand the
event back. A subscription idle since EOSE does not always deliver.

Fixed there (`8330464`): `useFollows` exposes `refresh()` — a one-shot `querySync`
folded into the same event map — called after every publish and unfollow path.
Marking the row optimistically from the click was explicitly rejected as the smaller
and wrong diff: the chip would then assert a publish the relays might have refused.
**Stations shared the defect** through the same path, where it would only ever have
looked like a lagging marker, since the local store already renders the row. The
key/fold step was extracted to `streamKey` + `ingestEvent` so the live stream and
the refetch fold identically.

That pass also verified the guid-less path: acast publishes no `<podcast:guid>`, so
its event is the minimal legal record and cross-user discovery there works by `#r`.
**Both discovery paths are now measured** — `#i` on Linux, `#r` on macOS.

#### ✅ Linux confirmation of the fix + cross-machine sync — 2026-08-19

Followed *Bitcoin And* from the installed Linux build: `213b1f152f9e`, 12:57:47, all
three relays, carrying `i: podcast:guid:43a4f801-…`. **The chip flipped without a
restart**, closing `Needs-verify: linux`. The guid matches the one S0 extracted into
`podcasts.json`, and podhome embeds the same value in its feed path — corroborated
twice. Slug generated clean, no `-2` needed.

**Cross-machine sync observed, not argued.** Replaying the resolver over live relay
data returns **2** followed shows: this one, and macOS's McCormack follow — which
**merges onto the local sub** rather than appearing as a `relay` row. A follow
published on one machine, correct on another, is the whole point of decision #10.

The same data shows NIP-09 rule 1 holding live: `the-peter-mccormack-show` was
deleted at 12:41 and re-published at 12:45, and resolves as **followed**.

> **Tooling note for whoever repeats this.** `nak`'s output is lost when `timeout`
> kills it mid-write to a redirect or `tee` — capture with command substitution
> (`S=$(timeout 25 nak req …)`) instead. An empty capture read as "resolves 0
> shows" during this session and was briefly mistaken for a result.

#### S4 — closed

Every phase of this slice is built and verified on both platforms. Remaining items
are **follow-ups, not gaps in the slice**:

- [x] `t: talk` in the fixtures — **resolved 2026-08-19 by dropping it.** Neither
      candidate source could be published unasked: the feed's own categories are
      harvest, which this contract keeps off the wire, and the user's categories are
      typed into a private notes dialog and must not reach a relay by surprise. `t`
      stays *accepted* in the contract (a deliberate topic control is the way in) and
      the note there now says so. The fixture-diff test was also self-consistent
      rather than true — it fed the fixture's own `t` values back into the builder,
      so it stayed green while the fixture advertised a tag ntune cannot emit. It now
      builds with **no topics, as `publish_show` is actually called**, and was checked
      by reinserting the bogus tag: it fails.
- [ ] **Unfollow and unsubscribe are one gesture** — hit on both platforms now. The
      ✕ on a published row does both and the `following` chip is not a toggle, so a
      follow cannot be retracted while keeping the subscription. Local housekeeping
      and a public act should not share a control.
- [x] **Single-instance guard** — done 2026-08-19 with
      `tauri-plugin-single-instance`; a second launch reveals the existing window and
      exits. Note it also excludes `make dev` from running beside the installed app,
      since both share the identifier *and* the data dir (only the keyring is split
      by profile) — giving debug builds their own `-dev` store is the follow-up.
- [ ] 5 stale station tombstones on `relay.fizx.uk`, and the state the app cannot
      exit that the macOS session recorded (a deleted station's row is hidden, so no
      ✕ remains to re-issue from, while the publish guard blocks re-adding it).
- [ ] Settle the `t` question above.
- [ ] Decide on a **single-instance guard** (see below) — arguably a prerequisite
      for trusting any multi-run verification.
- [ ] **Unfollow and unsubscribe are one gesture.** The ✕ on a published row does
      both, and the `following` chip is a chip, not a toggle — so there is no way to
      retract a follow while keeping the local subscription. Inherited from the
      Stations tab, but arguably wrong here: unsubscribing is local housekeeping,
      unfollowing is public. Likely fix is making the chip a toggle, leaving ✕ as
      "remove from my list".

#### Hazard found while verifying: no single-instance guard

Two ntune processes were running against one data directory (a `--tray` instance
from before S0, plus one left over from the guid test). Nothing prevents this — the
project has no `tauri-plugin-single-instance` — and every durable store assumes a
single writer with last-writer-wins on disk.

The concrete risk is the serde-drop failure again, from an old *process* rather
than old code: the pre-S0 instance's `PodcastSub` has no `guid` field, so any
subscription write from it would silently strip all 8 harvested guids. Nothing was
lost (the store was checked: 11 subs, 8 guids, 11 `latestAt` intact), and both
instances were quit before testing. But the class of bug is now twice-seen and
should be closed structurally rather than by remembering to quit stale apps.

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
