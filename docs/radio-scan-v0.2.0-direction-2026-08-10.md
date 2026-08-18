# ntune — v0.2.0 direction (the "make it durable" minor)

> **Status: DIRECTION — a versioned worklist, not settled spec.** This pins the
> next **minor** of ntune (radio-scan's L4 tuner/player). It sits *below* the
> [L4 UI build map](./radio-scan-ui-2026-08-04.md) — that doc owns the U-milestone
> arc and the standing **Open decisions**; this doc names which slices of it become
> **v0.2.0** and in what order. Suite conventions: **[SUITE.md](../SUITE.md)**.
> Wire contract: **[schema/airplay-design-2026-07-28.md](../schema/airplay-design-2026-07-28.md)**.
> Treat the checklist as the worklist; treat the Open decisions as gates to settle
> *inside* this minor, not after it.

Date: 2026-08-10 (slice 4 added 2026-08-18) · current version: **0.1.1-beta.4**
(unreleased) · branch: `main` · this note proposes the **0.1.1 → 0.2.0** cut.

---

## Why a minor, and why *now*

Through the 0.1.1 line ntune grew from radio-only to **radio + podcasts + tray**,
and U4 taught it to **harvest** a lot of identity/metadata from feeds and ICY
headers. But that harvested data is **ephemeral** — recomputed each session, never
written. The concrete symptom driving this minor is **export serializer-drift**:
what Export writes can diverge from what the UI shows, because nothing durable sits
between harvest and render. 0.2.0's headline is therefore a single theme —

> **Harvested metadata becomes durable state.** Everything ntune learns about a
> station or show survives a restart, backs the export byte-for-byte, and gives
> per-episode features (chapters, transcripts) something real to attach to.

This is deliberately a **plumbing minor**, not a feature splash. It's the seam every
later arc (U5 chapters, feed collections, NIP-51) has been written to wait for.

---

## The headline: metadata persistence (U4.5)

Call it **U4.5** — it slots between U4 (harvest) and U5 (polish) and is the thing
the U4 notes kept saying "…persist it — revisit display later" about.

### Scope
1. **Stations.** Harvested `station.v1` description + ICY-on-tune-in headers
   (`station_icy` probe) persist to the local store alongside the existing
   `stations.json` fields. A re-probe overwrites the harvested slice; user edits
   never get clobbered.
2. **Podcasts.** The full Tier-A harvest (author, categories, language, copyright,
   website, email, `podcast:guid`, `podcast:funding`, top `podcast:value`
   `lnaddress`, the wide/permissive stash) persists per subscription. Re-fetch
   overwrites the **harvest** slice freely.
3. **The `image` URL** finally lands where U4 said it should: **stored, not
   rendered** (link kept, optional disk cache deferred). Display stays a later call.
4. **Feed bodies** (added 2026-08-18, **built** — see below). Parsed episodes +
   identity persist per feed, so the Podcasts tab opens on the last known state
   instead of a blank slate while every subscription refetches.

### The feed body cache (slice 4)

The subscription list and the harvest slice above are *small* state. The **bodies**
— episodes, hundreds per feed — were the loudest instance of the same problem: the
session cache lived in a module-level object in `PodcastTab.tsx`, so it died with
the process and every launch re-downloaded all eleven feeds before showing anything.

Decisions taken (they are the compatibility surface, so they are recorded here
rather than left to the code):

- **Where:** `<app_data_dir>/feed-cache/<fnv1a64(url)>.json`, **one file per feed**
  — a refreshed feed rewrites only itself, so a 700-episode archive never forces a
  rewrite of the other ten. The URL rides *inside* the envelope; nothing depends on
  the filename being readable.
- **Envelope:** `{url, fetchedAt, etag?, lastModified?, podcast}`. `fetchedAt` means
  *last confirmed current*, so a 304 restamps it.
- **Freshness is the server's call, not a TTL.** Each entry replays its ETag /
  Last-Modified as a conditional GET; an unchanged feed answers **304** — no body,
  no reparse. Measured 2026-08-18 across the live subscriptions: 3 of 4 sampled
  feeds honour `If-None-Match` (podbean, fountain.fm, nashownotes); the BBC's CDN
  answers 200 regardless, which simply degrades to today's behaviour.
- **Paint order:** disk first (one batched `cached_podcasts` read for the whole
  list), network second, in the background. The refresh pass tracks *fetched this
  session* rather than *present in cache*, or a disk-primed row would look fetched
  and never see today's episodes.
- **Eviction:** none by age. `save_local_podcasts` prunes bodies whose feed is no
  longer subscribed — unsubscribing is the only way to orphan one, so the directory
  tracks the sub list instead of growing forever.
- **Not exported.** Bodies are a cache, not state: `export == persisted state`
  covers the subscription + harvest slices, and re-deriving a body costs one fetch.
  Keeping bodies out of the export keeps backups small and portable.

### The rule that makes it safe (carried verbatim from U4)
- **Harvest and enrich live in separate slices.** Harvest is overwrite-on-refetch;
  enrich is user-authored, **gap-fill only**, and **never overridden by harvest**.
- **Keying:** podcasts by **`podcast:guid` when present, else feed URL**; stations by
  **slug + url** (matches the existing dedupe key). This is the same curated-JSON-
  overlay pattern nledger uses, and the exact seam U5's NIP-51 collections build on.
- **Feed always wins** over enrichment for any field the feed carries; enrichment
  stays dormant-but-stored if the feed later starts carrying it.

### Definition of done
- [ ] Restart preserves every harvested station + podcast field (no re-fetch needed
      to re-render identity).
- [ ] **Export == persisted state** — the drift is gone by construction (export
      serializes the stored slice, not a live recompute).
- [ ] Re-fetch/re-probe overwrites only the harvest slice; a manual enrich survives.
- [ ] `image` URL is in the persisted model and round-trips through export/import;
      still unrendered.
- [ ] Import merges into the persisted slices (harvest-vs-enrich preserved), deduped
      by the keys above.
- [x] **Feed bodies survive a restart** — the tab paints from disk, then refreshes
      by conditional GET (slice 4, built 2026-08-18).
- [x] **An import never wipes harvest.** `latestAt` proved the rule: `mergeSubs` is
      incoming-wins, so an OPML or pre-field export used to reset it. Harvest now
      gap-fills from the existing sub; a fetch still overwrites freely.

---

## Secondary slices (land if cheap, else defer to 0.3)

These are **not** blockers for the 0.2.0 tag — the persistence seam alone justifies
the minor. Pull them in only if they fall out naturally once state is durable.

- **NIP-46 bunker login parity** (U5). Mirror the suite signing table so ntune's
  write path (U2 station publish) isn't keyring-only. Independent of persistence;
  cut here or in 0.3.
- **`feed.v1` "heavy rotation"** (U5). Now *feasible* because listening history can
  finally persist — but it's a genuine feature, not plumbing. Record the intent;
  don't gate the tag on it.
- **OPML export/import** for feed collections (U5 forward arc, **read-only half**).
  A keyless JSON/OPML bundle rides the existing U4 import/export seam. NIP-51
  **authoring** stays out — that's the Open-decision-#9 line and does not cross in
  this minor.

---

## Open decisions to settle *inside* 0.2.0

Persistence forces answers to questions the UI map left open. Settle these as part
of the work, not after:

- **#5 — now-playing source of truth.** Once observations can persist, "proxy when
  tuned, relay otherwise" stops being hand-wavy. *Lean: both, proxy preferred;
  persist the last-known per-source so the card isn't blank on reopen.*
- **#4 — does L4 emit `airplay.v1`?** Durable local observations make L4 a real
  de-facto sensor. *Lean: still write to the bridge/`airplay.json`, one publisher —
  but 0.2.0 is where the persisted observation store that would feed it gets built.
  Decide emit-vs-handoff here even if emission ships later.*
- **#10 (new, 2026-08-18) — podcast follows have no wire form.** Stations publish
  (`station.v1`), podcasts don't: subscriptions live in `podcasts.json` + OPML and
  sync nowhere. That asymmetry is not academic — it is *why* two podcast feeds were
  published as stations in 2026-08 (`on-the-wire`, `a-duck-in-a-tree`): "follow this
  stream" was the only publish button in the app. Both had to be deleted by hand,
  and `#r` — the relay-filterable cross-user station identity — briefly carried feed
  URLs that no client can tune.
  *Lean: a sibling **`show.v1`** kind (31242, contiguous with 31240/31241), same
  shape as `station.v1` with `r` = the feed URL.* It costs little to spec because
  the Stations|Podcasts split already exists in the UI, and it keeps `#r` honest
  per-kind rather than overloading the station namespace. The alternative is NIP-51
  collections, which is decision #9 and explicitly deferred (authoring is the
  read→write identity boundary); a `show.v1` **follow** is the read-side half and
  does not cross that line. Settle the kind number here even if publishing ships
  later. Guard already landed in the meantime: `publish_station` now refuses a
  conclusively non-audio URL (see below), so the same mistake can't reach a relay
  again — but refusing is not the same as offering the right home for the follow.
- **#7 — npub-audio scope.** Not triggered by persistence; leave at `1063`-first.
  Note it only so 0.2.0 doesn't accidentally widen the harvest schema for kind-1.

## Guardrails added along the way

- **`publish_station` refuses non-stream URLs (2026-08-18).** A header-only probe
  runs before signing; a **conclusively** non-audio content-type (`*/xml`, `rss`,
  `html`, `json`) is refused with a message pointing at the Podcasts tab. No
  content-type or a failed probe **passes** — a genuine mount that advertises
  nothing must never be blocked. This deliberately mirrors `audioVerdict` in
  `AddStationDialog.tsx`, but the two differ in strength on purpose: the dialog
  guards the **local** store and is always overridable ("Add anyway" — it's your
  device), while the publisher guards the **relays** and refuses outright, because
  that copy is the one other people read. Unit-tested against the content-types
  measured on the live subscriptions.

---

## Explicitly out of scope for 0.2.0

- **NIP-51 collection authoring** (the read→write identity boundary, #9) — deferred
  to a later, explicitly-gated phase.
- **Podcast chapters / transcripts / soundbites** (U5) — these are *why* persistence
  goes first, but they attach to per-episode state that 0.2.0 only makes *possible*.
  The 0.2.0 harvest walker should stay **item-aware** (already the U4 stance) so
  chapters extend it rather than force a rewrite — but no chapter UI here.
- **Spectrum visualiser / rodio tap** (#3) — no audio-engine change this minor.

---

## Suggested tag & CHANGELOG shape

- Cut **0.1.1** (final) from the current beta line first, *or* roll beta.3's tray +
  import work straight into the 0.2.0 notes — either is fine; recommend rolling up so
  there's one clean "durable state" story.
- CHANGELOG headline for **0.2.0**: *"Harvested station & podcast metadata is now
  persistent — export reflects exactly what's stored, and identity survives a
  restart."*
- Pin the persistence key rules (guid‖url, slug+url) in the CHANGELOG body — they're
  a compatibility contract for import/export from here on.
