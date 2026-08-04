// station.v1 (kind 31241) — the parse + resolve layer for the tuner's station
// list. Pure functions over raw nostr-tools events; the relay transport lives
// in hooks/useStations.ts (same split as nplay's lib/feed.ts ↔ useFeed).
//
// Contract: ../../../schema/station.v1.json (PROPOSAL — not yet SHA-pinned).
// A station is parameterised-replaceable (addressable): re-publishing the same
// `d` replaces it in place. Consumers MUST require only d + name + r; every
// descriptive tag (fmt / br / server / t) is optional.

import type { Event as NostrEvent } from "nostr-tools";

export const STATION_KIND = 31241; // station.v1 — a followed radio stream
export const DELETE_KIND = 5; // NIP-09 deletion

// The suite owner key (one person = one npub) — the same constant nplay's
// feed.ts uses. U1 reads THIS author's published stations ("own stations"
// per the contract's subscription filter); following other npubs / #r-URL
// cross-user discovery comes later.
export const OWNER_NPUB =
  "npub1j9kztnc85ednd7ncqhe37ag0evnltn8z6wd84jfqx4ts4gn89gks0vxesa";
export const OWNER_PUBKEY =
  "916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d";

const D_PREFIX = "airplay:station:";

/** A tunable stream — the subset of station.v1 the UI needs. Shared by the
 *  relay reader and the Rust seed fallback (lib/tauri.ts). */
export interface Station {
  /** Stable id — the `d` suffix (slug) from `airplay:station:<slug>`. */
  slug: string;
  name: string;
  /** Stream URL (the relay-filterable `r` tag). */
  url: string;
  /** Advertised content-type, e.g. "audio/aacp". Optional. */
  fmt: string | null;
  /** Advertised bitrate in kbps. Optional. */
  bitrate: number | null;
  /** Genre / topic slugs (the `t` tags). */
  tags: string[];
}

/** Derive a stable, filesystem-safe slug (the `d` suffix) from a station name.
 *  Lowercased, non-alphanumerics collapsed to single hyphens, trimmed. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const tag = (ev: NostrEvent, k: string): string | undefined =>
  ev.tags.find((t) => t[0] === k)?.[1];
const all = (ev: NostrEvent, k: string): string[] =>
  ev.tags.filter((t) => t[0] === k).map((t) => t[1]);

/** The addressable coordinate `31241:<pubkey>:<d>` — the replaceable identity. */
export function stationAddress(ev: NostrEvent): string {
  return `${STATION_KIND}:${ev.pubkey}:${tag(ev, "d") ?? ""}`;
}

/** Turn a raw kind:31241 event into a Station, or null if it lacks the
 *  structurally-required d + name + r (an invalid/partial record). */
export function parseStation(ev: NostrEvent): Station | null {
  const d = tag(ev, "d");
  const name = tag(ev, "name");
  const url = tag(ev, "r");
  if (!d || !name || !url) return null;
  const brRaw = tag(ev, "br");
  const br = brRaw != null ? parseInt(brRaw, 10) : NaN;
  return {
    slug: d.startsWith(D_PREFIX) ? d.slice(D_PREFIX.length) : d,
    name,
    url,
    fmt: tag(ev, "fmt") ?? null,
    bitrate: Number.isFinite(br) ? br : null,
    tags: all(ev, "t"),
  };
}

/**
 * Resolve a raw event stream into the displayable station list: keep only
 * `ownerPubkey`'s stations, drop any the owner deleted (kind:5 referencing the
 * `a` coordinate), dedupe replaceables by address keeping latest created_at,
 * and skip structurally-invalid records. Sorted by name.
 */
export function resolveStations(
  events: NostrEvent[],
  ownerPubkey: string,
): Station[] {
  // Owner kind:5 deletions referencing a station address (NIP-09 `a` tags),
  // keyed to the LATEST deletion time per address. NIP-09: a deletion only
  // voids events with created_at <= its own — so re-publishing a station after
  // unfollowing it (same slug, later timestamp) must NOT stay tombstoned.
  const deletedAt = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== DELETE_KIND || e.pubkey !== ownerPubkey) continue;
    for (const t of e.tags) {
      if (t[0] === "a" && t[1]?.startsWith(`${STATION_KIND}:`)) {
        const prev = deletedAt.get(t[1]) ?? 0;
        if (e.created_at > prev) deletedAt.set(t[1], e.created_at);
      }
    }
  }

  const byAddr = new Map<string, { station: Station; createdAt: number }>();
  for (const ev of events) {
    if (ev.kind !== STATION_KIND || ev.pubkey !== ownerPubkey) continue;
    const address = stationAddress(ev);
    const delAt = deletedAt.get(address);
    // Suppress only if deleted and NOT re-published after the deletion.
    if (delAt !== undefined && ev.created_at <= delAt) continue;
    const station = parseStation(ev);
    if (!station) continue;
    const prev = byAddr.get(address);
    if (!prev || ev.created_at > prev.createdAt) {
      byAddr.set(address, { station, createdAt: ev.created_at });
    }
  }

  return [...byAddr.values()]
    .map((v) => v.station)
    .sort((a, b) => a.name.localeCompare(b.name));
}
