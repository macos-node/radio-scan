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
