# Multi-device sync for stations & podcasts — decision needed

> **Status: ACCEPTED 2026-08-19. Step 1 built; steps 2–3 outstanding.** This settles *how* a user's stations
> and shows reach every one of their devices intact, before any code depends on the
> answer. It touches the **`d` tag format** in
> [`../schema/station.v1.json`](../schema/station.v1.json) and
> [`../schema/show.v1.json`](../schema/show.v1.json), so changing it later means
> re-publishing every event — hence deciding first. Sits alongside decision #10 in
> the [v0.2.0 direction](./radio-scan-v0.2.0-direction-2026-08-10.md).

Date: 2026-08-19 · raised by: Acid Jazz missing from ntune on Linux

---

## The symptom, and what it actually showed

Acid Jazz was absent from the Stations list on Linux while present on macOS. It was
not a sync failure in the ordinary sense: the station had **never** been in Linux's
local `stations.json`, and reached the machine only through the relay overlay. That
relay copy (`airplay:station:acid-jazz`) had been deleted on 2026-08-06; the
deletion was `a`-only, which `relay.fizx.uk` ignores, so the event kept being served
while ntune filtered it client-side. The machine had been showing the correct answer
since 6 August. Retracting the tombstones by event id on 2026-08-19 only made the
wire agree.

The useful part is what the investigation exposed underneath.

## Three causes, all visible in current data

**1. Nothing publishes what is already local.** Publishing happens once, in the
Add-station dialog, when signed in. Anything added while signed out, imported from
JSON, or arriving from the first-run seed is invisible to every other device. At the
time of writing this machine held **10 local stations while the relays held 0**.

**2. The address is chosen per device, so one station acquires several identities.**
`d` is `airplay:station:<slug>` derived from the *typed name* (`slugify(name)`), and
shows use `uniqueShowSlug(title)` with a `-2` suffix on collision. Two machines
adding the same stream under slightly different names produce two addressable events
for one station. The four events retracted today — `acid-jazz`, `acid-jazz-2`,
`acid-j`, `aj` — are that bug, not a naming experiment.

**3. URL string equality is not stream identity.** The merge dedupes on the raw URL.
Measured on this machine's store:

```
drone-zone   https://ice1.somafm.com/dronezone-128-mp3
dronezone    http://ice1.somafm.com/dronezone-128-mp3     <- same stream, two rows
```

Podcasts already dodge most of this because `mergeFollows` prefers
`<podcast:guid>` — 7 of 10 subscriptions carry one — which is exactly the
URL-independence argument decision #10 made. Stations have no equivalent.

---

## Decision 1 — how an item is addressed

**Proposed: derive `d` from the canonical URL, not from the name.**

```
canonical(url) = host[:port] + path + ?query      (see the vectors — this one-liner
d              = airplay:station:<sha256(canonical)[:16]>      is NOT the spec)
                 airplay:show:<sha256(podcast:guid or canonical)[:16]>
```

**Pinned, because a canonicalization disagreement is silent and permanent.** The
review was right that a sentence cannot carry this: default ports, query strings,
percent-encoding and path case were all undecided, and two devices differing on any
of them mint two addresses for one stream — this decision's own bug, one layer down.
The algorithm and **21 conformance vectors** are now at
[`../schema/station-address.vectors.json`](../schema/station-address.vectors.json)
with a `.sha256` sidecar, following ndisc's `master-key.vectors.json`. Every case the
review named is decided there:

| case | decision |
|---|---|
| scheme (`http`/`https`) | dropped — same mount, and ntune proxies `http` anyway |
| host case | lowercased |
| `:80` / `:443` | dropped; any other port kept (Icecast lives on 8000) |
| trailing slash | dropped |
| **path case** | **preserved** — Icecast mounts are case-sensitive |
| **query string** | **kept** — some mounts select format by it |
| percent-encoding | decoded, then re-encoded consistently |
| no scheme given | assumed `http` |

Both publishers must conformance-test against the vectors before shipping.

Same stream ⇒ same address on every device ⇒ the event is *replaceable* rather than
duplicated, without coordination — **for as long as the URL holds**. Measured against
this machine's store: **10 station rows collapse to 9 distinct streams** (the
http/https Drone Zone pair merges), and **10 podcast subs stay 10** with no
collisions. The macOS review measured a second store: no collapse there, but four
duplicate pairs had been pruned by hand that same day, each sharing a
`<podcast:guid>` and differing only by host — the prune this rule replaces.

*Corrected after review:* an earlier draft said "permanently", which is false. A
mount that moves host re-addresses, and `#r` discovery splits before-and-after; Acid
Jazz is a bare IP literal (`79.111.14.76:8000`), so this is not hypothetical.
**Stations have no publisher-stated identity to fall back on** — `icy-name` is
harvested since U4.5 H2 but is a banner (SomaFM's is prose, Acid Jazz's stream states
none), too weak to key on. So the station half inherits exactly the weakness
`<podcast:guid>` solves for shows, and a moved station is a **known manual repair**.
Name-derived slugs are still worse: they break on any rename, which happens more
often than a mount moves.

- *Why the scheme is dropped:* the same mount is served over both, and ntune already
  proxies `http` for playback. Treating them as different stations is a bug that
  survives only because nobody looked.
- *Why hash rather than a readable slug:* a slug has to be unique, and uniqueness
  requires either coordination or a suffix — and the suffix is precisely what turned
  one station into four events. The human-readable name lives in the `name` tag,
  where it can differ per device without splitting identity.
- *Cost:* every existing event is re-addressed once. There are currently **2 shows
  and 0 stations** published, so this is the cheapest it will ever be.

**Alternative rejected:** keep name-derived slugs and dedupe on read. That leaves
duplicate events on the wire for other clients to trip over, and cross-user `#r`
discovery still sees several rows for one stream.

## Decision 2 — what "removed" means

Per-item events make removal an explicit act (`kind:5`), and today's measurements
show that act is unevenly honoured: an `a`-only deletion was ignored by
`relay.fizx.uk` for two weeks while other relays dropped it. Adding the `e` tag
fixed it, but the asymmetry is a property of the network, not a bug we closed.

**Proposed: keep per-item events, and make the two acts separate everywhere.**
The Podcasts tab already does this as of 2026-08-19 — `following` toggles publication,
✕ removes locally, and neither implies the other. Stations still conflate them.
For sync this distinction is *required*, not cosmetic: "remove from this device" must
not retract the item for every other device.

**Alternative considered — NIP-51 set events (one replaceable list per kind).**
Attractive because totality is atomic and removal is just absence, which sidesteps
`kind:5` entirely. Rejected for now because it trades one failure mode for a worse
one: two devices publishing their own view of the set clobber each other
last-writer-wins, and a device that has been offline republishes a stale list,
silently deleting whatever it never saw. That is an *omission* bug, and omissions are
harder to notice than duplicates. Revisit if per-item events prove noisy at scale;
it is also the natural home for decision #9's collections.

## Decision 3 — how a device reaches "totality"

With 1 and 2 settled, sync is: **relay set ∪ local store**, per device, with local as
a cache. What is missing is a way to contribute what a device already has.

**Proposed: an explicit "publish my list" action**, per tab, that publishes every
local item not yet on the relays — no automatic publishing on import, for the reason
already recorded in the `show.v1` build map: an OPML import of 31 feeds would fire 31
events at hosts already observed rate-limiting a read sweep.

Open sub-question: whether a device should ever publish items it *received* from the
relays (re-asserting another device's entry). Leaning no — a device publishes only
what a person did on it — but this needs settling before the button exists.

---

## Version skew (raised by macOS, `fda15d5`) — answered

Migrating the live follows exposed a case the decision did not cover: a device on a
build older than the contract keeps publishing the old format and nothing says so.
The macOS build was five hours behind step 1, republished both follows as name-slugs,
every relay accepted them, and the UI showed `following`. It was caught only because
the expected addresses had been computed in advance.

**Adopted — the reader-side check.** Two `show.v1` events sharing an `r` or an `i`
are the same show at two addresses, which is never a legitimate state; the same holds
for two `station.v1` sharing an `r`. Surface that as **one row flagged
needs-migration** rather than as two follows. It needs no contract change, works
retroactively on events already published, and would have caught this with no
foreknowledge. **Lands with step 2.**

**Declined for now — a `dfmt` marker tag.** Its own limitation is decisive: a build
predating the marker cannot emit one, so it could not have caught the incident that
prompted it, and its value is entirely prospective. For *this* transition the format
is already self-describing — a pre-#11 `d` is a word-slug, a post-#11 one is exactly
16 lowercase hex — so a reader can tell them apart for free. Revisit if a future
change is hash-to-hash, where shape can no longer distinguish them; the duplicate
check above covers the symptom either way, whatever the cause.

## What this does not decide

- **Playback state, positions, favourites.** Different problem: high-frequency,
  low-value, and a poor fit for addressable events.
- **Harvest and enrich slices.** They stay local (U4.5's "harvest is not wire"); a
  synced item carries its URL and identity, and each device harvests for itself.
- **The live logger.** Acid Jazz's 24/7 ICY logging stays on macOS and is a
  scheduling question, not a sync one — see the episodic handoff note.

## Review from macOS (2026-08-19) — second dataset, two caveats

Reviewed against this machine's store, which is differently shaped from the one the
draft measured (6 stations, 25 subscriptions vs 10 and 10). **The proposal holds; two
things want stating before it is accepted.**

Measured here under the proposed keying:

```
stations: 6 rows -> 6 distinct   (4 https, 2 http, no scheme-pair duplicates)
podcasts: 25 subs -> 25 distinct (guid-or-canonical, no collisions)
```

No collapse on this profile — but it is confirming evidence rather than a null
result. This store held **four duplicate pairs** on 2026-08-19 (Bitcoin And
podhome=soundcloud, Once Bitten! and TFTC fountain=anchor, Closed Network
yellowball=anchor), each pair sharing a `<podcast:guid>` and differing only by host.
They were pruned by hand. Under this proposal they would have collapsed on their own,
which is the case for it: the manual prune is what the rule replaces.

**Caveat 1 — a URL-derived address is only as stable as the URL, and one of these is
a bare IP.** Acid Jazz is `http://79.111.14.76:8000/acidjazz`, an IP literal. If that
mount moves host the hash changes: the address orphans, and cross-user `#r` discovery
splits into before-and-after. This is the same instability decision #10 identified
for feed URLs — podbean serving one byte-identical document from two hostnames — and
the podcast side answers it with `<podcast:guid>`, a publisher-stated identity
independent of location. **Stations have no equivalent**, so the station half of this
proposal inherits the weakness the podcast half solved. Not a reason to reject
(name-derived slugs fail the moment anyone renames, which is more common), but
"permanently and without coordination" overstates it. Suggest the draft say instead:
stable while the mount's URL is stable, and record re-addressing a moved station as a
known manual repair. `icy-name` is harvested as of U4.5 H2 and is the only
publisher-stated identity stations have — too weak to key on (SomaFM's is a banner,
and Acid Jazz's stream states none at all), but worth noting as the reason no better
key exists.

**Caveat 2 — canonicalization is contract, so it needs vectors, not a sentence.**
"Lowercase host, scheme dropped, trailing slash dropped" leaves open: default ports
(`:80`/`:443` present or absent), query strings (some Icecast mounts carry them),
`;stream.nsv`-style suffixes, percent-encoding, and path case — which must stay
case-sensitive while the host is lowercased. Two devices disagreeing on any of these
produce two addresses for one stream, which is the exact bug this decision exists to
end, reintroduced one layer down. The suite already has the pattern for this: ndisc's
`master-key` normalization ships `schema/master-key.vectors.json` with a `.sha256`
sidecar, and every consumer conformance-tests against it. Suggest the same here —
pin the algorithm with vectors covering the cases above, before either publisher
implements it, since a canonicalization disagreement is silent and permanent.

Neither caveat changes the recommended order below; both belong in step 1, which is
where the contract is written.

## Migration — the two events published under the old scheme

Both existing `show.v1` follows were addressed by name-slug and re-address under
this decision:

```
airplay:show:the-peter-mccormack-show        -> airplay:show:f5a81dadd784fbf5  (url-derived, no guid)
airplay:show:bitcoin-and-bitcoin-economic-news -> airplay:show:070f66ab867bb7ce  (guid-derived)
```

Nothing migrates them automatically, and nothing should: re-addressing is a publish,
and this app does not publish without being asked. **Toggle `following` off, then on**
for each.

> **These instructions were wrong when written, and the correction is instructive.**
> They assumed the `e` tag would carry the retraction to the old event. It does — but
> the `a` tag in the same event named the *newly derived* address, so one click asked
> two different things of two kinds of relay: `relay.fizx.uk`, which deletes by id,
> dropped the orphan; `nos.lol` and `relay.primal.net`, which delete by address,
> tombstoned the **good** follow instead. Not a failed cleanup — a different and worse
> outcome per relay, and the orphans then had to be retracted out-of-band with `nak`
> because nothing in the app could name them. Fixed in `468aff7`: `Show`/`Station`
> keep the event's own `d` verbatim and retraction uses it, deriving only for a row
> that exists solely on this device. **The instructions above are safe as of that
> commit** — the hazard was never the toggle, it was retracting at a computed address
> rather than the one the event occupies.

## Raised from macOS — version skew is invisible (open sub-question)

Step 1 shipped correctly; migrating the two live follows exposed something the
decision does not cover. **A device running a build older than the contract keeps
publishing the old format, and nothing anywhere says so.**

What happened on 2026-08-19, in order:

1. The installed macOS build (17:56, from `7e09e08`) predated step 1 by five hours.
2. Toggling both follows off and on in it republished them as
   `airplay:show:the-peter-mccormack-show` and
   `…:bitcoin-and-bitcoin-economic-news` — name-derived, the format step 1 removed.
3. Every signal said success: relays accepted the events, the UI showed `following`,
   the retractions were clean. The only reason it was caught is that the derived
   addresses had been computed independently beforehand and could be compared.
4. Installing the new build made the app address by content, find nothing at those
   addresses, and render the old events as **separate relay-only follows** — the
   duplication of decision #11's opening paragraph, arriving through version skew
   rather than through naming.

This matters more as devices multiply, and it compounds: a stale publisher re-mints
name-derived addresses for streams every current device addresses by content, so the
duplicate set grows with each toggle rather than converging.

**Two mechanisms, and one honest limitation.**

- **A `d` format marker on the event** (e.g. `["dfmt", "station-address.v1"]`).
  *Limitation worth stating plainly:* it cannot catch the build that caused tonight's
  problem, because a build predating the marker cannot emit it. Its value is
  prospective — once every publisher emits it, **absence becomes the signal**, and the
  *next* format change is detectable instead of silent. If it is wanted, it is
  cheapest now, while 2 events exist.
- **Reader-side same-target detection**, which needs no contract change and works
  today: two `show.v1` events sharing an `r` (or an `i`) are the same show at two
  addresses. That is not a legitimate state — it is precisely what a stale publisher
  produces. Surfacing it as one row flagged *needs migration*, rather than as two
  follows, turns tonight's silent duplication into something visible and actionable,
  and it would have caught this without anyone knowing the expected hashes.

Suggest the reader-side check regardless, since it is small, contract-free and
retroactive; the marker is a judgement call for whoever owns the contract. Both belong
with step 2 rather than blocking it.

*(A related hazard found while migrating — that a retraction re-derived its address
instead of reading it off the event, making pre-migration follows unretractable — is
fixed in `468aff7`, not left as a question.)*

## Recommended order if accepted

1. Canonical-URL addressing (contract change + both publishers) — do this first and
   alone, while only 2 events exist. **Gate:** both publishers pass
   `schema/station-address.vectors.json` before either publishes a single event.
2. Station ✕ / publish separation, mirroring the Podcasts tab.
3. "Publish my list", once 1 and 2 make it safe to press twice.
