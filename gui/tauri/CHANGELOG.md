# Changelog — ntune

radio-scan's L4 desktop tuner/player. Notable changes per release. Dates are the
tag date; unreleased work sits under the top heading until tagged.

## 0.2.0-beta.1 — 2026-08-25

First beta of the 0.2.0 line, and the first tag since `0.1.1-beta.3` — the
`0.1.1-beta.4` manifest bump was never cut, so everything below has been riding
untagged. Verified on **both** platforms: Linux (Ubuntu GNOME/X11) and macOS 26.6.1.

The **"make it durable" minor** it is a beta *of* is not finished — metadata
persistence (U4.5) is still under Planned below. Per §8.1 of the cross-session
contract a `-beta.N` carries no parity or completeness claim; it is an installable
artifact per phase, which is how each platform gets something to test with. The
claim that both platforms do this and it works belongs to the stable `0.2.0`.

Direction: [`../../docs/radio-scan-v0.2.0-direction-2026-08-10.md`](../../docs/radio-scan-v0.2.0-direction-2026-08-10.md).

### Planned
- **Metadata persistence (U4.5).** Harvested station (`station.v1` description +
  ICY-on-tune-in) and podcast (Tier-A identity: author, categories, language,
  copyright, website, email, `podcast:guid`, `podcast:funding`, top
  `podcast:value` `lnaddress`, `image` URL) fields persist to the local store.
  Harvest and user **enrich** stay separate slices — re-fetch overwrites harvest
  freely, **feed always wins**, enrichment is gap-fill-only and never clobbered.
  Keyed by `podcast:guid`‖feed-url (podcasts) and slug+url (stations) — a
  compatibility contract for import/export from here on. `image` URL stored, not
  yet rendered. **Export == persisted state**, closing the serializer-drift.

### Changed
- **Stations and Podcasts now speak one language.** The two tabs described the same
  three-way state in two vocabularies: Podcasts said `24 shows · 24 here · 24
  published` with a glyph per dimension, Stations said `9 local · +11 station.v1`
  with a `published` text chip and no device dimension at all — a station published
  from another machine was identifiable only by a MISSING ✕, which is the one
  signal a reader cannot see. Stations now carries the same two-slot column and the
  same sync line, from the same code: the control is one shared component
  (`components/StateSlots.tsx`) and the counting one shared helper (`lib/sync.ts`),
  so the two lists cannot drift apart again by editing only one of them. Each tab
  keeps its own words — a station is KEPT where a podcast is SUBSCRIBED — because
  sharing a control should not mean sharing a vocabulary.
  The old header count was not just differently worded, it was misleading:
  `9 local · +11 station.v1` reads as twenty stations. There are **eleven** — nine
  held here and published, two published from the other machine — which is exactly
  what `11 stations · 9 here · 11 published` says. The header no longer counts at
  all; it says where the list came from and leaves tallying to the line.
- **The list no longer re-sorts when a row LEAVES.** The prefetch effect re-runs
  whenever the row set changes — which includes a removal — and it settled the
  order every time it finished, even when it had fetched nothing. So unsubscribing
  or unfollowing one show reshuffled the whole list, which is the "rows moved under
  me" complaint wearing a different hat, and it would have thrown a ghost away from
  the one spot the eye was looking. The settle is now gated on the sweep actually
  bringing something back. Measured: the title column at the top of the list is
  pixel-identical across a removal (0 differing pixels), while the status line
  updates as it should.
- **The Stations list lines up too.** Same defect as the Podcasts list, found by
  looking at a screenshot: a relay-only station has nothing local to remove, so ✕
  was dropped entirely rather than emptied, and that row's whole right-hand cluster
  slid **40 px** right — the `published` chip ended at x=1814 on every local row and
  x=1854 on the two `station.v1` rows followed from another machine. Copy and ✕ now
  share one fixed gutter, the publish control has a fixed rail (`publish` and
  `published` are different widths, and the unpublished state carries a border the
  published one does not — a list holding one of each would have gone ragged the
  same way), and the bitrate is a cell that stays when empty. Measured after: three
  local and two relay-only rows all end at the same pixel. The bitrate cell is a
  latent case rather than an observed one — every station in the seeded list states
  a bitrate, and one reporting 0 still renders `0k` — but the first feed that omits
  it would have collapsed the column.
- **A row's state is two glyphs in a fixed column, not three scattered signals.**
  Whether a show is HERE (subscribed on this device) and whether it is PUBLISHED (a
  `show.v1` the relays serve) used to be spread across a `relay` chip, a
  `follow`/`following` text toggle, and whether ✕ was drawn at all — so reading one
  row meant assembling three things, and comparing two rows meant doing it twice.
  Both slots are now drawn in the same two positions on every row: a device glyph
  (filled = here, hollow = followed elsewhere) and a share glyph (filled in the
  Nostr tint = published, hollow = local only). Every word the glyphs replaced
  survives in their tooltips. `nostr` stays a chip of its own — a feed SERVED FROM
  an npub is a different fact from a follow PUBLISHED TO the relays.
  Deliberately not symmetrical: a filled device slot is an indicator, not a button.
  Removing a local subscription stays on ✕, which asks first, because one stray
  click on a hover-revealed row must not drop a subscription. Both confirm dialogs
  were rewritten — they described the chips that no longer exist.
- **The Podcasts list is a set of columns now, not a row of optional chips.** Every
  slot — spinner, `nostr`/`relay` chips, copyright, language, the follow control, the
  copy/✕ gutter — is rendered on every row and owns its width; only the *contents* are
  conditional. Before, each absent element collapsed and shoved everything to its
  right, so no two rows lined up and there was nothing straight for the eye to run
  down. The worst offender was ✕, which is absent by design on a relay-only row (there
  is no local subscription to remove): dropping the button outright pulled that row's
  whole right-hand cluster **40 px** rightwards. Measured after: every row's follow
  chip ends on the same pixel column, relay-only and subscribed alike. The language
  cell also had to be allowed to CLIP — a flex item keeps `min-width: auto`, so
  `en-us` grew its own cell and pushed the columns left on exactly those rows.
- **The list no longer re-sorts under the pointer while feeds arrive.** `Recent`
  orders on the newest episode date, and those dates land one feed at a time as the
  prefetch or a `refresh` sweep runs — the order was recomputed on every one of those
  cache writes, which is **26 reorders in ~21 s** on the reference profile. Relay-only
  rows moved furthest: no date until their feed answers, so each started at the bottom
  and jumped into the middle mid-sweep. Sort keys are now frozen between settle
  points — a sort change, the disk prime landing, and a sweep *finishing* — never
  while one runs. A url the map has not seen is keyed on the spot, so a feed just
  added or just discovered on a relay still lands in its right place immediately.
  Verified live: the list region is pixel-identical across a full 27-feed refresh.
- **A row that just changed state is tinted for a moment.** Following or unfollowing
  altered one small chip, often hundreds of pixels from the pointer, in a list of
  dozens — a change you had to hunt for. The row now carries a brief Nostr-tinted
  wash, in both the list and card views.

### Added
- **See the latest episode of a logged show (Linux).** The read half of the logger
  surface, and the mirror of the control gap: RadioBar has read these tracklist
  logs on macOS from the start, while on Linux the weekly parsers wrote to
  `~/radio-scan-data` and nothing could show it. A toolbar button — present only
  when logs exist — opens the latest episode per show: title, date, track count,
  the tracklist in running order, and **Listen on Mixcloud** where the parser
  captured a link. Read-only: it cannot fetch and cannot write, so a stale view
  means the weekly timer hasn't run, which is what the tray's LOGGER section is
  for. Reads the clean log by preference and falls back to the raw one, so a log
  that has never been cleaned still shows rather than looking empty. A show with
  no link says so rather than offering a dead button — On The Wire has no audio to
  play, and A Duck in a Tree needs none, being a podcast you play in ntune itself.
- **The tray can pause the logger (Linux).** RadioBar has been two surfaces in one
  menubar on macOS — a viewer over the logs, and a controller for the logging jobs
  — and Linux only ever got the viewer: pausing meant `systemctl --user` in a
  terminal. ntune's tray now carries a LOGGER section with a live status row per
  job and the actions to pause, resume, and fetch an episodic show now. It is kept
  behind its own separator and header, and every verb names its job and says
  "logging", because ntune's own playback lives in the same menu.
  The status rows say **two things, not one**: `Acid Jazz — logging`, `Acid Jazz —
  stopped · returns at login`, `On The Wire — paused · stays off`. `is-active` and
  `is-enabled` are different questions and stopped-but-enabled is what pausing a
  24/7 logger produces, so a checkbox would have lied about it. Pausing a stream
  logger is session-only and it comes back by itself; pausing a weekly show is
  persistent and it stays down — the same asymmetry RadioBar gets from launchd's
  `-w`, and mapping both to one verb would have looked identical in a menu and
  been a regression. Jobs that aren't installed don't appear at all.
- **Skip forward and back through an episode.** A podcast had one seek bar and no
  step: catching a line you missed meant aiming a 600-second bar at a 15-second
  correction, and stepping over an ad break meant the same aim in reverse. Two jog
  buttons now flank the transport — `⟲15` back, `⟳30` forward, the podcast
  convention and asymmetric for the reason the convention is: back is for a line,
  forward is for a break. `←` and `→` do the same from the keyboard, and `␣`
  toggles play — ntune's first key bindings. Both clamp to the episode: back from
  the first seconds rewinds to 0 rather than underflowing, forward near the end
  lands on the end. The jog writes the resume position immediately instead of
  waiting for the 4-second throttle, so a skip survives a quit taken right after
  it. Live stations leave the buttons disabled and the keys inert — a stream has
  no timeline to move through, which is the same `seekable` flag the seek bar
  already reads. The keys stand down while you're typing, while a dialog is up,
  and when a focused control already owns them (a button consumes `␣`, a range
  input owns the arrows), so nothing double-fires.
- **Unpublishing a relay-only station leaves a ghost too.** The twin of the Podcasts
  ghost, and the hole was worse here: a station published from another machine lives
  only on the relays, so retracting it took its STREAM URL with it — and a stream URL
  has no directory to look it up in. The row now stays until ntune closes, dimmed and
  marked `gone` beside its name, both slots hollow, brightening as you reach for it.
  The relay slot publishes it again at the same address, the device slot saves it
  here instead, ✕ dismisses it (no confirm — it is already gone from both sides).
  Counted nowhere, and specifically unable to hold `in sync` hostage. The `gone` chip
  sits INSIDE the elastic name block rather than in a column of its own: a chip in a
  fixed slot is a column that has to exist on every row forever, and one wider than
  its slot is what drags a column out of line.
- **`add all` and `publish all` for stations, and per-row save from the relays.**
  The mirror of the Podcasts pair, and the same asymmetry: `add all (N)` saves every
  station published from another device onto this one — local, silent, no confirm,
  because nothing is published and each is undone by its own ✕ — while `publish all
  (N)` writes to every relay once per station and therefore asks first. Clicking a
  row's hollow device glyph does the same for one station. The stream URL was always
  in the row (the published event's `r` tag, which is what put it on screen); taking
  it across used to mean copying that URL out and pasting it into Add.
- **An unfollowed relay-only show leaves a ghost behind, so the click can be taken
  back.** Unfollowing a show that is followed but not subscribed here removed the
  only thing holding it in the list — and the row was the only place its feed URL
  still existed on this machine, so a mis-click could not be undone from the UI at
  all; you had to go to the other device and look the URL up. The row now stays
  until ntune closes: dimmed, marked `gone`, both slots hollow, brightening as you
  reach for it. One click on the relay slot follows it again at the same address,
  one click on the device slot subscribes it here instead, and ✕ dismisses it for
  good (no confirm — it is already off this device and off your relays; the row is
  only waiting). Session-only by design: persisting it would invent a third store
  to reconcile, and what needs covering is the seconds after a mis-click.
  A ghost is the fourth quadrant of a state space documented as having three — so
  `FollowState` grew a `ghost` case and says why: the three-way invariant holds
  over merge output, and this row lives above the merge, never persisted, never
  merged. It counts as neither here nor published, is left out of the sync line's
  totals, and specifically cannot hold `in sync` hostage — a tombstone for
  something you removed from both sides is not an unclosed gap.
- **A sync line, and `add all` to close the gap it names.** The Podcasts header used
  to read `10 subscribed · 26 published`, which sounds like this machine published
  26 — when 16 of those were follows from the other machine that this one had never
  subscribed to. It now reads `24 shows · 24 here · 24 published`: how many shows
  are in the list, how many are on THIS device, how many are published to your
  relays. The counts overlap by design (a synced show is both) and are not meant to
  total; the two gaps are what you act on, and they are the two buttons — `add all
  (N)` pulls in every show followed on the relays but missing here, `follow all (N)`
  publishes every subscription this device has never shared. Push and pull, one
  each. When both gaps are zero the line says **✓ in sync**.
  *That claim is scoped, deliberately:* it means every subscription here is
  published and every published follow is subscribed here. It cannot speak for the
  other machine — nothing in a relay read reveals what someone else's local list
  holds, so the other machine is in sync when it says so itself. The tooltip says
  as much rather than letting the badge overpromise.
  `add all` takes no confirm and no sequential runner, unlike `follow all`: it
  writes the local store once, touches no network, and publishes nothing — every
  row it adds is *already* a follow on the relays, which is why the row is on
  screen at all. `follow all` asks because publishing is a public act; this is
  housekeeping, undone per row with ✕, which does ask.
- **Subscribe a relay-only show onto this device, from its own row.** Clicking the
  hollow device glyph on a show followed from another machine subscribes it here.
  The feed URL was always in the row — it is the follow event's `r` tag, which is
  what made the row exist — but pulling a show across previously meant copying that
  URL out of the row and pasting it back into the Add box, which is a strange thing
  to have to do to two devices that already agree. Local only: nothing is published,
  because the follow it came from is already on the relays. Note the row does move
  when you click — it joins the local group, and lands first under **Added**, which
  is what "newest subscription first" means — so the brief tint on a just-changed
  row is doing real work here.
- **A `refresh` button on the Podcasts tab.** Feeds were fetched **once per launch**:
  `refreshed` is module-level, so the background prefetch skips a feed for the rest of
  the session and switching tabs does not re-run it — right for a prefetch, wrong for
  a window left open, where the episode lists quietly go stale with no way to say
  "check again". The button re-reads every subscription now, sequentially through the
  same runner publish-all uses (an unpaced burst is what drew rate limits from
  fountain.fm and anchor.fm during a read sweep), with no added delay since each
  request is paced by the one before it and a conditional GET makes an unchanged feed
  a 304. Progress shows as `refreshing 3/25…` and the result as `refreshed 25` or
  `refreshed 23, 2 failed` — one failing feed never stops the rest. `describeOutcome`
  gained a verb so publish and refresh share one vocabulary rather than growing two.
- **Podcasts sort by recency.** The Podcasts tab gets a **Recent | A–Z | Added**
  order switch beside the list/card toggle, defaulting to **Recent** — the feed
  that published most recently sits at the top. Each feed's newest-episode date is
  harvested on fetch and persisted on the sub (`latestAt`), so the order is already
  right on the first paint of the next launch rather than settling as the
  background prefetch trickles in; feeds with no known date keep their stored order
  at the bottom. The choice persists in the durable settings store
  (`ntune.podcastSort`). Ordering is display-only — the stored order is never
  rewritten, so **Added** always gets it back. (A first, small slice of the U4.5
  harvest-persistence above: harvested, re-derived on every fetch, feed always wins.)
  Persisting it needed the Rust `PodcastSub` struct to carry the field: serde drops
  unknown keys on the way in, so the first cut wrote a stamp the store silently
  discarded — the export serializer-drift U4.5 exists to close, met early.

### Added
- **Podcast identity is now stored, not just cached (U4.5 H1).** What a feed says
  about itself — author, categories, language, copyright, website, owner email, cover
  art URL, blurb — persists as a `harvest` slice on each subscription, with the
  timestamp it was taken. It lived only in the session/feed cache before, and a cache
  is explicitly not state: it is excluded from backups, pruned freely, and
  invalidated whenever the parser changes. The subscription store is what gets
  exported and carried between machines, so that is where a show's identity belongs.
  The slice is replaced wholesale on every fetch — the feed always wins — and absent
  fields stay absent rather than becoming empty strings, so "not stated" and "stated
  as blank" remain distinguishable. Verified on a 10-feed profile: all 10 carry 6–7
  fields.
- **The podcast owner's email is no longer confused with the editor's.** The scan
  kept whichever contact appeared first in the document, so a feed stating
  `<managingEditor>` before `<itunes:owner><itunes:email>` stored the editorial
  contact instead of the owner. Precedence is now decided after the scan: the
  podcast-native owner wins, and the RSS editor stands in only when no owner is
  stated.
- **Harvest no longer depends on a tab being open.** Absorbing what a feed states
  used to be an effect inside the Podcasts tab, so a fetch that resolved after the
  tab closed wrote the feed cache and never the subscription store — leaving the
  store thinner than what the app already knew, and an export thinner still. It is
  now a plain store operation with no view attached, and a startup pass folds the
  cache in, so a store that fell behind heals without the tab being visited.
- **Backups taken mid-session no longer drop station details.** A probe wrote
  through to the store but left the in-memory copy untouched, and the export reads
  the in-memory copy — so a station probed during a session was exported without
  what the stream had just told us, while the stored file was perfectly correct.
  The app now re-reads the store after a probe, the same "re-ask rather than assume"
  shape used for published follows.
- **Support links are harvested too (U4.5 H5).** `<podcast:funding>` and the top
  `<podcast:value>` lightning address now persist with the rest of a show's identity.
  Both are **stored and never acted on** — the U4 line (no payments, no writes)
  stands; keeping what a feed publishes commits to nothing. A `type="node"` recipient
  is deliberately skipped: it is a keysend pubkey, routing plumbing rather than an
  address a reader could use. Measured on a 10-feed profile: funding on 5, a
  lightning address on 3, each the highest-split recipient — platform cuts of 2% and
  7% correctly passed over.
- **A stale cached feed can no longer be re-asserted into the store.** When the
  parser is upgraded, bodies cached by the previous build are still worth showing —
  they are the last thing the app knew — but folding them into the durable store
  writes back a parse that has already been superseded. The startup healing pass and
  the tab's disk-prime both did exactly that, which is a second way for a parser fix
  to stay invisible after its cache-version bump. Cached bodies now arrive marked
  stale-or-not, decided where the version constant lives, so the renderer cannot get
  it wrong: paint anything, store only what this build actually parsed.
- **Share a whole list at once.** Stations gains **publish all** and Podcasts **follow
  all**, appearing only when you are signed in and only when something on this device
  has not been shared yet. They send one item at a time with a pause between, so a
  long list does not arrive as a burst that relays refuse, and one failure never stops
  the rest — you get `published 7, 2 failed` rather than silence. Neither touches
  anything already published, and neither re-publishes a station or show that came
  from another device: this machine shares what you did here, nothing else.
- **Stations: sharing and keeping are separate acts now.** The ✕ used to remove a
  station *and* retract it from your relays, so you could not tidy one device's list
  without changing every device's. **`publish` is a toggle** — click it to share a
  station, click `published` to stop — and ✕ removes it from this device only. A
  station you still publish stays listed, marked `relay`, until you turn `published`
  off; a station published from another machine has no ✕ at all, since there is
  nothing here to remove. Publishing is one click, unpublishing asks first. This
  matches the Podcasts tab, which was split the same way earlier.
- **A follow published twice is now called out.** If one device is running an older
  build it can publish the same station or show at a second address, and until now
  both simply appeared as ordinary rows — which is how one such case went unnoticed.
  Two follows pointing at the same feed or stream are never legitimate, so the app
  now says so once, above both lists, naming how many and what to do: unpublish and
  re-publish from the newest build.
- **Unsubscribing and unfollowing are separate acts now.** The ✕ on a published
  podcast used to do both at once, so you could not stop publishing a show without
  also dropping it from your list, or tidy your list without announcing it to your
  relays. **`following` is a toggle**: click it to retract the follow, and your
  subscription and episodes stay exactly as they are. ✕ is local only — remove a
  show you still follow and it stays listed, marked `relay`, until you turn
  `following` off. Following is one click; **unfollowing asks first**, because it
  publishes a deletion to every relay. A relay-only row has no ✕ at all, since there
  is nothing local to remove.
- **You can now fill in what a feed leaves out.** Expanding a podcast offers
  **fill in** (or **edit**, once you have) — author, website, contact email,
  language, copyright, categories, description. The screen makes the rule visible
  rather than leaving you to infer it: a field the show states itself is dimmed and
  says what the feed says, and anything you type there is **kept but not shown**,
  ready if the feed ever stops. Blank fields are dropped rather than stored empty,
  clearing every field removes your slice entirely, and saving without changing
  anything doesn't touch the store. Your notes are never overwritten by a re-fetch.
- **A show's identity can be filled in by hand (U4.5 H4, data model).** Each
  subscription gains an `enrich` slice beside its harvest, with two rules: **the feed
  always wins**, so hand-typed values show only where the feed says nothing; and
  **enrichment is never overwritten**, because a fetch replaces the harvest slice
  wholesale and nothing the user wrote lives in it. If a show later starts stating a
  field you filled in, your value goes **dormant rather than away** — hidden while
  the feed carries it, back if the feed stops. Values shown from your own slice say
  so on hover. There is no editor yet; this fixes the shape and the merge so the
  editor is a later screen rather than a migration.
- **Identity no longer waits on a fetch.** Expanding a podcast used to render
  nothing at all unless its feed had been fetched this session, which hid the stored
  identity exactly when it was the only thing left — offline, or straight after a
  restore. Identity now renders from the store, and only the episode list waits,
  saying so plainly.
- **Export is now exactly what is stored (U4.5 H3).** Backing up a station used to
  hand-list its fields, so the newly persisted `harvest` slice would have been
  dropped on the way out and unreadable on the way back — the serializer drift this
  minor exists to close, about to happen again. Both writers (the Stations tab and
  the app-level backup) now share one `toExportStation` shape, and the importer
  reads the slice back, so a backup restores the station you had rather than a
  thinner copy of it. The backup also stops emitting `eventId`, which identifies a
  relay event rather than a station and means nothing on another machine. A test
  walks every persisted field and fails if one is missing from the export, so the
  next stored field is either exported or caught — never quietly lost. Verified by
  round-tripping the real store: 10 stations and 10 subscriptions, 83 harvest fields,
  identical before and after.
- **Station identity survives a restart (U4.5 H2).** What a stream advertises on
  tune-in — `icy-name`, genre, bitrate, homepage, content-type — now persists as a
  `harvest` slice on the local station, with the time it was probed. It lived only in
  component state before, so a station's homepage and genre vanished on every quit
  and came back only after tuning in again. **Stations invert the podcast rule**:
  there the publisher's account of their own show wins, but `icy-name` is a stream
  banner and the name you typed is yours — so a probe only fills a description you
  never wrote, and a stated bitrate is never overwritten. The three-way merge (your
  words, this session's probe, the stored slice) moved into a pure, unit-tested
  `stationIdentity()`. A station that exists only on the relays has no local row, so
  its probe has nowhere durable to go; that reports rather than failing silently.
- **Owner email is finally harvested at all.** `feed-rs` does not surface
  `<itunes:owner><itunes:email>` or `<managingEditor>`, so the Tier-A "owner email"
  claimed since U4 had in fact **never** been captured — its identity chip could not
  have rendered. The channel scanner that reads `<podcast:guid>` now returns both in
  one pass (these documents reach 4 MB, so a second pass is not free), strips the RSS
  `address (Name)` wrapper, and ignores an address inside an `<item>` just as it
  ignores an episode's `<guid>`. Measured: 6 of 10 feeds state one and all 6 are now
  captured; the other 4 genuinely publish none. Persisting the slice is what exposed
  this — a live recompute hid it.
- **Debug builds get their own store.** A `tauri dev` run now reads and writes
  `<app_data_dir>-dev` (and `radio-scan-dev/` for the now-playing bridge) instead of
  the installed app's data — the suite convention that already covered the keyring,
  now covering the stores it mattered most for. Until this, `make dev` wrote your
  real `stations.json` / `podcasts.json` / `settings.json`, which is not a read-only
  visit: every store is a whole-file rewrite from an in-memory cache, so a dev build
  with different structs could drop fields it predates. Release paths are unchanged,
  so no user data moves. The bridge split matters separately: RadioBar reads the
  release path, and a dev run must not overwrite what it shows. The tray consumer
  now shares the producer's path resolver instead of restating it.
- **One instance per user.** ntune now refuses to start a second copy of itself:
  launching again reveals the window you already have. Every durable store here is a
  whole-file rewrite from an in-memory cache (`stations.json`, `podcasts.json`,
  `settings.json`, `feed-cache/`), so two processes silently overwrite each other —
  and a process running an **older build** is worse than a race, because serde drops
  every field its structs predate. Two instances were found running on 2026-08-19, a
  pre-guid `--tray` one alongside a newer one, with 8 harvested `podcast:guid`s a
  single subscription write away from being erased. **Note for developers:** a
  `make dev` run and the installed app now exclude each other, because they share
  both the bundle identifier and the data directory — quit one to run the other.
- **`show.v1` write path (S1).** `publish_show` (kind 31242) and `unfollow_show`
  land in Rust: a follow carries `d`/`name`/`r` (the **feed** URL), the feed's
  `<podcast:guid>` as a NIP-73 `i` tag when it states one, topic `t` tags and `alt`;
  the unfollow reuses the station deletion's `a` + `e` tagging. `publish_show`
  refuses a URL that conclusively serves **audio**, the exact mirror of
  `publish_station` refusing a feed — between the two guards, `#r` stays honest per
  kind. No UI yet; the Follow control arrives with S3.
- **Follow a podcast on the relays (`show.v1` S3).** The Podcasts tab gains a
  per-show **follow** control that publishes a `show.v1`, and rows already published
  show a `following` chip instead. Follows read back off the relays are merged into
  the list **by guid first, then URL** — the two are not interchangeable, since
  podbean serves one feed from two hostnames — so a show followed on another machine
  appears here (tagged `relay`) even though this device never subscribed to it.
  Unsubscribing a published show now retracts the follow as well, and the confirm
  dialog says so, with different wording for a relay-only row. Following is
  **deliberately per-show and never automatic**: podcasts arrive in bulk from OPML,
  and auto-publishing an import would fire dozens of events at hosts already seen
  rate-limiting a mere read sweep. Slugs are made unique with a `-2` suffix at
  publish time — `airplay:show:<slug>` is the addressable identity, so a collision
  would replace another show's event rather than create one. The control is hidden
  without a signing key.
- **`show.v1` read path (S2).** `lib/show.ts` parses kind 31242 into a `Show`
  (including the `podcast:guid` behind its NIP-73 `i` tag), and the relay hook now
  reads stations and shows over **one** subscription — they share an author, a relay
  set and the same kind:5 deletion stream, so a second pool would duplicate every
  delete for nothing. `useStations` becomes `useFollows`. The NIP-09 and
  replaceable-dedupe rules were **extracted** into `lib/addressable.ts` rather than
  copied: they encode that a deletion only voids events at or before its own
  timestamp (so unfollow → refollow works) and that an addressable event replaces
  rather than appends. The existing station tests pass through the extraction
  unchanged. Still no UI — S3.
- **Feeds' `<podcast:guid>` is now harvested (`show.v1` S0).** The Podcasting-2.0
  channel GUID — a show's identity independent of the URL serving it — is extracted
  on fetch and persisted on the subscription. It is what `show.v1` publishes as its
  NIP-73 `i` tag and what U4.5 keys the podcast harvest on, and it matters because a
  feed URL is demonstrably unstable: podbean serves the byte-identical document from
  two hostnames, which is how one show appeared in two places at once. `feed-rs`
  exposes no extension map, so this is read from the raw feed bytes with `quick-xml`
  (already an indirect dependency). Measured on an 11-feed profile: 8 carry a guid
  and all 8 were extracted; the 3 without one genuinely publish none (podbean, the
  BBC, acast). Accepts the element when its prefix resolves to a known podcast
  namespace **or** is literally `podcast` — No Agenda binds the prefix to the
  namespace's GitHub docs page, and a URI-only match would silently drop a guid the
  feed plainly states. An episode's `<guid>` is never mistaken for the show's.

### Fixed
- **…and a stalled stream no longer holds the stop open either.** The first fix
  checked the stop flag between metaint blocks, which is sub-second while data
  flows and useless when the socket goes quiet: the reader is parked *inside* the
  read and waits out `urlopen`'s 20s timeout. Reported from macOS, where launchd's
  ~20s `ExitTimeOut` loses that race — measured there as 20 `signal 15 received`
  lines against 1 clean `stopped.` across three weeks of pauses. The signal
  handler now tears the socket down, and the ORDER matters: `shutdown()` before
  `close()`, because closing a descriptor does not wake a thread already blocked
  reading it. Measured against a purpose-built stalling server: **14.1s → 0.25s**,
  and constant no matter when the signal arrives.
- **Stopping the live logger no longer takes 90 seconds and fails.** `radioscan.py`
  handled `SIGTERM` correctly, but the ICY reader only handed control back to that
  handler on a **track change** — so a stop sat unnoticed for however long the
  current song had left, systemd waited out its full `TimeoutStopSec`, SIGKILLed,
  and left the unit `failed`. Found by building the tray's Pause on top of it. The
  reader now checks the stop event every metaint block: a stop takes **0.16s** and
  lands `inactive`. Shared Python, so launchd's `unload` on macOS gets it too.
- **The transport no longer loses track of what the player is doing.** Play state
  was assembled from events — `playing` was set true by the `playing` event and
  nothing else — so a dropped or reordered event left the app believing something
  other than the truth, with no way back until the next track. On Linux
  (WebKitGTK) that was reachable in three clicks: pause an episode, skip, press
  play, and the app still thought nothing was playing, so the pause button no
  longer paused and `␣` did nothing while audio kept going. The spinner had the
  mirror-image bug — `waiting` raised it and only `playing` lowered it, so any
  seek while paused (including the automatic seek that restores your position on
  load) left it spinning over a stopped player, forever. Both now read the
  element itself: `playing` is "not paused", re-asked on every transport event
  and on every playhead move; the spinner is raised only by `waiting`/`stalled`
  and lowered by evidence of progress, so it means "stuck", not "recently
  seeked". Measured in the installed Linux app across pause → skip → resume →
  pause, which used to wedge and now holds.
- **Pausing during load no longer restarts the episode.** Resuming ran
  `a.play().catch(() => reload)`, and pausing while that play is still pending
  rejects it with `AbortError` — so the pause was read as a failed resume and
  answered by reloading the episode from the top and re-buffering it. The catch
  now ignores `AbortError`, which is the user pausing, not a failure. Latent
  before, and reachable the moment play state stopped lagging behind the element.
- **A retraction now names the address the event actually occupies.** Both unfollow
  paths re-derived the `d` from the item's URL/guid, which is only correct while the
  `d` format never changes — and decision #11 changed it. Measured on macOS with two
  real follows published before the change: the app computed the **new**
  content-derived address while the `e` tag named the **old** event, so the deletion
  pointed at two different things at once. A relay honouring NIP-09 by id would have
  dropped the orphan; one honouring it by address would have tombstoned the *good*
  follow instead — a different, worse split per relay. The two events had to be
  retracted out-of-band with `nak` because the app had no way to name them.
  `Show`/`Station` now carry the event's own `d` verbatim on relay-sourced rows, and
  `retraction_d()` uses it, deriving only for a row that exists solely on this
  device. Stations shared the defect through the same path and are fixed with it.
  Confirmed by mutation: making it derive unconditionally fails both new tests.
- **The cache-version rule is now enforced by the suite, not by memory.** Three tests
  pin the parse to `FEED_CACHE_VERSION`: one snapshots the channel scan's **output**
  for a fixture exercising every rule it encodes (guid, `<managingEditor>` stated
  before `<itunes:owner>`, funding with a label, and a value block whose highest
  split is a keysend `type="node"` recipient that must be passed over); one pins the
  serialized `Podcast` key set, which is what a serde drop silently narrows; and one
  asserts the two constants moved together. The snapshot is the important half —
  the owner-precedence change renamed no field and added none, so anything checking
  struct shape alone would have passed it. Verified by mutation: reverting that
  precedence fails the snapshot test. The rule has fired four times in two days,
  three of them after S0 wrote it down; it should not need writing down again.
- **The owner/editor precedence fix now reaches existing installs.** `70a8c25`
  changed which contact a feed's channel resolves to, but left `FEED_CACHE_VERSION`
  at 4 — so every cached body still counted as current, the parse never re-ran, and
  the pre-fix owner stayed in the store. Worse in combination with the same commit's
  startup healing pass: it faithfully re-asserted the stale value on every launch.
  Measured on macOS with a warm 25-feed cache — Cypherpunk Bitstream kept
  `contact@taz0.org` (its `<managingEditor>`) after the fix shipped, and flipped to
  `bitstream@taz0.org` (its `<itunes:owner><itunes:email>`) only when that one cache
  entry was deleted by hand, proving the fix correct but unreachable. Bumped to 5,
  which is the rule S0 wrote down: **a parse change must bump the version or it lands
  silently.** The counter has now earned itself four times.
- **A follow published mid-session now marks its own row.** Following a podcast
  published the `show.v1` correctly but left the row reading `follow`; the chip only
  flipped to `following` after a restart (measured on macOS 2026-08-19 —
  `de61654e9d48…` was live on all three relays while the app still showed it
  unfollowed). `follow()` keeps no local state by design, waiting for the open
  `useFollows` subscription to hand the event back, and a subscription idle since
  EOSE did not deliver it. `useFollows` now exposes **`refresh()`** — a one-shot
  re-read on the same pool, folded into the same event map, so it can never blank
  the list — and publish, unfollow and the station add/unfollow paths all call it.
  **The rule that published state is never local state is kept:** the row is marked
  from what the relays actually serve, by re-asking rather than by trusting the
  click. The key/merge step is now `streamKey` + `ingestEvent` in `lib/addressable.ts`,
  shared by the live stream and the refetch so both fold an event identically (a
  duplicate reports no change, and a re-send across a reconnect costs no recompute);
  7 unit tests cover it. Stations shared the defect through the same path — visible
  only as a lagging published-marker, since the local store already rendered the row.
- **The feed cache no longer starves a parser change.** Cache entries now record the
  parser generation that produced them (`FEED_CACHE_VERSION`). Conditional-GET
  validators are replayed only for a body the running build knows how to read, so a
  build that learns to extract a new field re-fetches in full instead of being handed
  its own stale parse forever. Without it the `podcast:guid` work above would have
  landed silently: eleven cached bodies would have answered 304 and kept their
  guid-less parse until each publisher happened to touch their feed. A stale-version
  entry still paints immediately; only its revalidation is skipped.
- **Unfollow now names the event as well as the address.** A station deletion
  tagged only the addressable `a` coordinate, and several relay implementations
  honour NIP-09 **by event id** — they accept an `a`-only deletion and go on
  serving the event. Measured on the suite's own hub 2026-08-18: `relay.fizx.uk`
  was still serving all 7 stations it had been told to delete, while nos.lol had
  dropped them. The kind:5 now carries an `e` tag with the id of the event being
  deleted whenever the row came from a relay (a local-only row has no published
  event to name, and stays `a`-only). ntune itself was never affected — it filters
  deletions client-side in `resolveStations` — but anything else reading that relay
  was.
- **A feed URL can no longer be published as a station.** `publish_station` now
  probes what the URL actually serves and refuses a conclusively non-audio
  content-type (`*/xml`, `rss`, `html`, `json`), pointing at the Podcasts tab
  instead. `station.v1` defines `r` as the stream mount and `#r` is the
  relay-filterable cross-user station identity, so a feed there publishes a
  non-tunable row into everyone's discovery space — which is how two podcast feeds
  reached the relays in 2026-08. Inconclusive probes (no content-type, or a failed
  request) still pass, so a genuine mount that advertises nothing is never blocked.
  The add dialog's matching warning stays **soft** — it guards the local store,
  which is yours to overrule; the publisher is hard, because that copy crosses the
  wire.
- **Podcast feeds no longer start from a blank slate on every launch.** Parsed feed
  bodies now persist to `<app_data_dir>/feed-cache/`, one file per feed, so opening
  the Podcasts tab paints the last known episodes and identity immediately instead
  of waiting on eleven refetches; the refresh then runs in the background. The
  session cache it replaces was a module-level object that died with the process.
  Freshness is the server's call rather than a TTL: each entry stores the ETag /
  Last-Modified it was served with and replays them as a conditional GET, so an
  unchanged feed answers **304** — no body, no reparse. Bodies for unsubscribed
  feeds are pruned on the next subscription write, and the cache is deliberately
  **not** exported (a body costs one fetch to rebuild; `export == persisted state`
  stays about the subscription + harvest slices). Design + decisions:
  [`../../docs/radio-scan-v0.2.0-direction-2026-08-10.md`](../../docs/radio-scan-v0.2.0-direction-2026-08-10.md)
  § the feed body cache.
- **Restoring an old export no longer wipes the podcast sort dates.** `mergeSubs`
  is incoming-wins, so importing a backup written before `latestAt` existed — or an
  OPML file, which has nowhere to carry it — reset every feed's newest-episode date
  and flattened the **Recent** order until each feed refetched. `latestAt` is
  harvest, not user data, so an incoming entry that lacks it now inherits the stamp
  already on the sub: a fetch still overwrites it freely (feed always wins), an
  import only gap-fills.
- **Removing a podcast or station now asks first.** The hover-✕ on a row/card
  removed the subscription outright, with no undo — and it sits exactly where the
  pointer already is, so a stray click silently dropped a feed. Both lists now open
  a confirm dialog naming the item and its URL; focus lands on **Cancel**, and
  Escape or the backdrop dismisses. The station dialog also says when removal will
  publish a Nostr `kind:5` unfollow (i.e. when signed in), since that leaves the
  published list too. Escape-to-close was added to the shared `Modal`, so every
  dialog gets it.
- **Podcast subscriptions now persist durably.** They moved off webview
  `localStorage` into a Rust-written `podcasts.json` (a synchronous `std::fs::write`
  next to `stations.json`), so a subscription lands on disk the instant it's added
  and survives **any** exit. WebView2 only flushed `localStorage` on a graceful
  window-close, so a crash / force-kill / OS sign-out / the tray "Quit" dropped
  every unflushed change — imported podcasts vanished on reopen while file-backed
  stations survived (Windows-visible; fragile on all platforms). Legacy
  `localStorage` subs migrate into the store on first launch. The subscription-list
  precursor to the U4.5 harvest-metadata persistence above. Diagnosis + evidence:
  [`docs/podcast-persistence-2026-08-11.md`](docs/podcast-persistence-2026-08-11.md).
  Verified macos 2026-08-12. Needs-verify: linux.
- **UI preferences now persist durably too.** Theme, volume, and the list/card view
  toggles moved off `localStorage` into a generic Rust settings store
  (`settings.json`, same synchronous write) — same durability gap, so they could
  reset on a non-graceful exit. `localStorage` stays a mirror (the `index.html`
  pre-paint theme read needs a synchronous source); the store is authoritative on
  load and migrates existing prefs on first launch. Verified macos 2026-08-12.
  Needs-verify: linux.
- **Fresh install no longer starts muted.** `loadVolume` let an unset value slip
  past its range guard (`Number(null) === 0`), so a first run defaulted to 0
  instead of the intended 0.9. An unset volume now returns 0.9.

## 0.1.1-beta.3 — unreleased

A cross-platform menubar/tray companion, and JSON import to round-trip the
station/podcast lists.

### Added
- **Menubar / tray companion (U6, opt-in `--tray`).** A small cross-platform tray
  now-playing surface — icon + menu with the live "Artist — Title", **Show ntune**,
  **♥ Favorite current track** (enabled only on a live track, running the same
  toggle as the in-window heart), and **Quit**. Off unless launched with `--tray`,
  so the default app is unchanged; the installed Linux desktop entry defaults to
  `--tray`, macOS is opt-in. Verified on macOS (WKWebView) and Linux (Ubuntu
  GNOME/X11). *GNOME needs the shell AppIndicator extension in addition to
  `libayatana-appindicator3-1` — see the README.*
- **JSON import (stations & podcasts).** Each list gets an **Import** button (native
  Open dialog) mirroring Export: merges into the local store / subscriptions,
  deduped (stations by slug+url, podcasts by url), imported entries first — safe to
  re-import. Round-trips the export shape and accepts minimal hand-made files
  (`[{name,url}]` — a missing station slug is derived, descriptive fields default).

## 0.1.1-beta.2 — 2026-08-05

Station/podcast list management: adds persist locally with no key, and both
lists are copyable + exportable.

### Added
- **Local station store.** Added stations now save to a **local, no-key store**
  (`stations.json` in the app-data dir — Linux `~/.local/share/uk.fizx.ntune`,
  macOS `~/Library/Application Support/uk.fizx.ntune`), so an add persists across
  restarts without a Nostr key. On a **fresh install** it's seeded from the built-in
  starter stations so the tuner is testable out of the box; every seed is an
  ordinary, **removable** row and does not come back once removed. When signed in,
  an add still also publishes a `station.v1` to the relays (best-effort — a relay
  failure never loses the local save), so the Nostr layer is now an optional
  overlay on top of the always-available local list.
- **Copy URL + JSON export (stations & podcasts).** Every station and podcast row
  gets a hover **copy** button (stream / feed URL → clipboard, brief ✓). Each list
  has an **Export** button that writes the list as pretty JSON via a native Save
  dialog (`ntune-stations.json` / `ntune-podcasts.json`). New Tauri plugins:
  `clipboard-manager` + `dialog`; the file is written by an `export_file` command.

## 0.1.1-beta.1 — 2026-08-05

The listening surface grows from radio-only to **radio + podcasts**, with live
track info. Verified on Linux and macOS.

### Added
- **Now-playing (U3).** The player bar shows the live **♪ Artist — Title**,
  parsed from the stream's ICY metadata by the loopback proxy (decode ladder
  UTF-8 → Windows-1251 → Latin-1). Updates on every track change. *Currently
  `http://` (proxied) stations only.*
- **Podcasts tab (U4a).** A **Stations | Podcasts** switch. Subscribe to a
  podcast by RSS feed URL (persisted locally); episodes are fetched and parsed
  server-side (Rust `reqwest` + `feed-rs`) and played through the same player.
- **Episode playback.** Playback now models two source types — a **live station**
  (non-seekable, with ICY now-playing) and a **podcast episode** (seekable, with
  a seek bar and **resume across sessions**, keyed by enclosure URL).
- **Favorites (♥).** Like the current track — a ♥ in the player bar saves the
  now-playing (artist / title / station) to a **local curated favorites log**; a
  Favorites dialog lists and removes them. Local-first v1 (the kind:7-reaction-on-
  `airplay.v1` layer is a later step — see the menubar-companion direction).

### Fixed
- **Proxy follows HTTP redirects.** Podcast enclosures (and some radio mounts)
  almost always `30x` through a tracking/CDN; the proxy previously masked that as
  a `200` and the webview got an HTML redirect page instead of audio. Now
  `http→http` is followed internally and `http→https` is handed to the webview.
- **`audio/aacp` MIME, platform-split.** webkit2gtk (Linux) needs `audio/aac`;
  WKWebView (macOS) needs the legacy `audio/aacp` — remapped on Linux only.
- **Unfollow → re-follow.** A re-added station reappears (the station list now
  honours NIP-09 deletion timestamps rather than tombstoning the address).

### Known limitations
- Full **seek on `http` podcast enclosures** needs the proxy to forward
  `Content-Length` and honour `Range` (206). `https` feeds seek fully today.
  Tracked as the reqwest-proxy follow-up (also TLS upstreams + `https`
  now-playing).
- Now-playing is `http`-only (proxied streams).

## 0.1.0 — 2026-08-05

Initial ntune release — a Nostr-native internet-radio tuner.

### Added
- **Tuner (U0).** Tauri 2 + React shell; three themes (mono / fizx / upleb);
  tune and listen to internet-radio streams via a hidden `<audio>` element.
- **Station registry (U1).** The station list is the user's published
  `station.v1` (kind 31241) events, read off the relays (`relay.fizx.uk` +
  nos.lol + relay.primal.net), with a seed fallback.
- **Follow / publish (U2).** A signing key in the OS keychain (import / generate)
  lets you follow a station — publishing a `station.v1` — and unfollow (NIP-09
  delete). One npub per person, shared with the ndisc suite.
- **Mixed-content loopback proxy.** A packaged app's secure origin blocks plain
  `http://` media; a Rust loopback proxy relays `http://` streams so they play.
- **Packaging.** Ships `.deb` (Linux) + `.dmg` (macOS) via `ntune-release.yml`.
  (The `.AppImage` is deferred — its bundled GStreamer freezes on playback; see
  `docs/appimage-gstreamer-2026-08-04.md`.)
