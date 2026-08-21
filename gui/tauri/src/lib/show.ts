// show.v1 (kind 31242) — the parse + resolve layer for followed podcasts. The
// feed-shaped sibling of lib/station.ts: same addressable, per-publisher shape,
// but `r` carries an RSS/Atom FEED url rather than a stream mount. Pure functions
// over raw nostr-tools events; the relay transport lives in hooks/useFollows.ts.
//
// Contract: ../../../schema/show.v1.json (PROPOSAL — not yet SHA-pinned).
// Consumers MUST require only d + name + r; `i` (the podcast:guid), `t` and `alt`
// are optional — 3 of 11 feeds in the reference profile state no guid at all.

import type { Event as NostrEvent } from "nostr-tools";
import { addressOf, resolveAddressable } from "./addressable";
import { countSync, type SyncCounts } from "./sync";
import type { Sub } from "./podcasts";

export type { SyncCounts };

export const SHOW_KIND = 31242; // show.v1 — a followed podcast feed

const D_PREFIX = "airplay:show:";
/** NIP-73 external content id prefix for a Podcasting-2.0 channel GUID. */
const GUID_ID_PREFIX = "podcast:guid:";

/** A followed show, shaped to sit alongside a local `Sub` (lib/podcasts.ts) —
 *  hence `title`/`url` rather than station.ts's `name`. The wire tag is `name`. */
export interface Show {
  /** Stable id — the `d` suffix (slug) from `airplay:show:<slug>`. */
  slug: string;
  title: string;
  /** The RSS/Atom feed URL (the relay-filterable `r` tag). */
  url: string;
  /** `<podcast:guid>` from the `i` tag — identity independent of the feed URL. */
  guid?: string;
  /** Genre / topic slugs (the `t` tags). */
  tags: string[];
  /** Optional human note — the event *content*. Not the feed's own description:
   *  harvest stays local, so this is only what the user wrote. */
  description: string | null;
  /** Id of the event this came from, so an unfollow can name it in an `e` tag. */
  eventId?: string;
  /** The event's own `d`, verbatim. Set only for relay-sourced rows, and used
   *  INSTEAD of re-deriving when retracting: an event published under an older
   *  `d` format (pre-decision-#11 name-derived slugs) must be deleted at the
   *  address it actually occupies, not at the one today's rules would compute. */
  d?: string;
}

const tag = (ev: NostrEvent, k: string): string | undefined =>
  ev.tags.find((t) => t[0] === k)?.[1];
const all = (ev: NostrEvent, k: string): string[] =>
  ev.tags.filter((t) => t[0] === k).map((t) => t[1]);

/** The addressable coordinate `31242:<pubkey>:<d>`. */
export function showAddress(ev: NostrEvent): string {
  return addressOf(ev, SHOW_KIND);
}

/** Turn a raw kind:31242 event into a Show, or null if it lacks the
 *  structurally-required d + name + r. */
export function parseShow(ev: NostrEvent): Show | null {
  const d = tag(ev, "d");
  const name = tag(ev, "name");
  const url = tag(ev, "r");
  if (!d || !name || !url) return null;
  // Only a podcast:guid id is ours; NIP-73 allows any external id here, so an
  // unrelated `i` tag must not be read as this show's guid.
  const guid = all(ev, "i")
    .find((v) => v.startsWith(GUID_ID_PREFIX))
    ?.slice(GUID_ID_PREFIX.length)
    .trim();
  const show: Show = {
    slug: d.startsWith(D_PREFIX) ? d.slice(D_PREFIX.length) : d,
    d,
    title: name,
    url,
    tags: all(ev, "t"),
    description: ev.content?.trim() || null,
    eventId: ev.id,
  };
  if (guid) show.guid = guid;
  return show;
}

/** Resolve a raw event stream into the user's live followed shows. NIP-09 and
 *  replaceable-dedupe rules are shared with stations — see lib/addressable.ts. */
export function resolveShows(
  events: NostrEvent[],
  ownerPubkey: string,
): Show[] {
  return resolveAddressable(events, SHOW_KIND, ownerPubkey, parseShow, (s) => s.title);
}

/** A row in the Podcasts list: a local subscription, a published follow, or both.
 *  `show` is set when this feed is published as a `show.v1`; `relayOnly` marks a
 *  follow that exists on the relays but not in this device's `podcasts.json` —
 *  i.e. one followed from another machine. */
export interface FollowRow extends Sub {
  show?: Show;
  relayOnly?: boolean;
  /** A row kept on screen after its follow was retracted, for this session only.
   *  Unfollowing a relay-only show removes the one thing holding it in the list —
   *  and its feed URL went with it, so a mis-click could not be undone from the
   *  UI at all. A ghost is not merge output and is never persisted: it is the UI
   *  remembering, until the window closes, what it was just told to forget. */
  ghost?: boolean;
}

/** Where one row stands between this device and the relays.
 *
 *  The two questions a row answers are "is it HERE?" (a local subscription) and
 *  "is it PUBLISHED?" (a `show.v1` the relays serve). Of the four combinations,
 *  only three can come out of `mergeFollows`: neither-here-nor-published gives it
 *  nothing to build a row from.
 *
 *  `ghost` is that fourth quadrant, and it exists only above the merge — a row the
 *  UI holds open after a retraction so the retraction can be undone (see
 *  `FollowRow.ghost`). It is never persisted and never merge output, so the
 *  invariant still holds where it was claimed: over merged rows. Callers switching
 *  on this must handle all four; a ghost counts as neither, which is the point. */
export type FollowState = "synced" | "local-only" | "relay-only" | "ghost";

/** Classify a row. `relayOnly` implies published — a relay-only row is one that
 *  mergeFollows built out of a follow event, so the follow is by definition there.
 *  `ghost` is checked first: a ghost has neither flag, and would otherwise read as
 *  `local-only`, which is the one reading that would be actively wrong. */
export function followState(row: FollowRow): FollowState {
  if (row.ghost) return "ghost";
  if (row.relayOnly) return "relay-only";
  return row.show ? "synced" : "local-only";
}

/** This device's convergence with the relays, over the merged podcast rows.
 *  Shape and caveats live in lib/sync.ts, shared with stations so the two tabs
 *  cannot describe the same situation in different words. */
export function syncCounts(rows: FollowRow[]): SyncCounts {
  return countSync(
    rows.map((row) => {
      const state = followState(row);
      return {
        here: state === "synced" || state === "local-only",
        published: state === "synced" || state === "relay-only",
        ghost: state === "ghost",
      };
    }),
  );
}

/** Merge local subscriptions with published follows.
 *
 *  Matched by **guid first, then URL** — the U4.5 keying rule, and not
 *  interchangeable: podbean serves one feed from two hostnames, so the same show
 *  subscribed here and published there can differ by URL while sharing a guid.
 *  Matching by URL alone would show it twice; matching by guid alone would miss
 *  every feed that states none (3 of 11 in the reference profile).
 *
 *  Local subs keep their order and their harvest; relay-only follows are appended,
 *  so nothing a user has locally is ever displaced by what a relay says. */
export function mergeFollows(subs: Sub[], shows: Show[]): FollowRow[] {
  const byGuid = new Map<string, Show>();
  const byUrl = new Map<string, Show>();
  for (const sh of shows) {
    if (sh.guid) byGuid.set(sh.guid, sh);
    byUrl.set(sh.url, sh);
  }

  const claimed = new Set<Show>();
  const rows: FollowRow[] = subs.map((sub) => {
    const match =
      (sub.guid ? byGuid.get(sub.guid) : undefined) ?? byUrl.get(sub.url);
    if (!match) return sub;
    claimed.add(match);
    return { ...sub, show: match };
  });

  for (const sh of shows) {
    if (claimed.has(sh)) continue;
    const row: FollowRow = {
      url: sh.url,
      title: sh.title,
      show: sh,
      relayOnly: true,
    };
    if (sh.guid) row.guid = sh.guid;
    rows.push(row);
  }
  return rows;
}
