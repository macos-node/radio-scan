<img src="docs/n-suite-mark.svg" alt="n" width="72">

# The n-suite — vendored hub (placeholder)

> **This is a placeholder.** The **canonical** `SUITE.md` lives in `ndisc`
> (`github.com/xjmzx/ndisc`) and is the single source of truth for the roster,
> the shared architecture conventions, the Nostr wire contract, the design
> language, and the roadmap.
>
> Per suite convention, each app **vendors a pinned copy** of the hub. When
> radio-scan is set up as a real suite member, replace this file with the
> current `ndisc/SUITE.md` (and vendor the `docs/n-suite-mark.svg` mark and the
> `schema/*.json` contracts alongside it), pinned to the SHA in use that release.

## radio-scan's place in the suite (summary)

radio-scan is the suite's first **sensor** and first inherently **multi-user**
surface: `ndisc` publishes what you *own*; radio-scan publishes what you (and
others) *hear*. It:

- **produces** two new events — `station.v1` (streams a user follows) and
  `airplay.v1` (what a stream played) — see
  [`schema/airplay-design-2026-07-28.md`](./schema/airplay-design-2026-07-28.md);
- **consumes** `ndisc`'s `catalogue.json` / `release.v2` to reconcile heard
  tracks against owned releases (provenance source `radio`);
- **reuses** the suite's social primitives (`7` reactions, `31239` feed notes,
  `30000` registry, `4550` sign-off) for interaction;
- is the first real consumer of the deferred **cross-user aggregation** and
  **master-release-key** items on the SUITE.md roadmap.

A local **macOS menubar viewer** (`gui/macos/`, RadioBar) already exists as a
non-Nostr front-end over the logger's output — an early seed of the suite's
deferred P4 UI, not itself a suite surface.

Full identity: [`radio-scan-introduction.md`](./radio-scan-introduction.md).
Build order and open decisions:
[`docs/radio-scan-buildmap-2026-07-28.md`](./docs/radio-scan-buildmap-2026-07-28.md).
