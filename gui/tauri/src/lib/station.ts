// station.v1 (kind 31241) — the parse + resolve layer for the tuner's station
// list. Pure functions over raw nostr-tools events; the relay transport lives
// in hooks/useStations.ts (same split as nplay's lib/feed.ts ↔ useFeed).
//
// Contract: ../../../schema/station.v1.json (PROPOSAL — not yet SHA-pinned).
// A station is parameterised-replaceable (addressable): re-publishing the same
// `d` replaces it in place. Consumers MUST require only d + name + r; every
// descriptive tag (fmt / br / server / t) is optional.

import type { Event as NostrEvent } from "nostr-tools";
import { addressOf, resolveAddressable, DELETE_KIND } from "./addressable";

export const STATION_KIND = 31241; // station.v1 — a followed radio stream
export { DELETE_KIND };

// The suite owner key (one person = one npub) — the same constant nplay's
// feed.ts uses. U1 reads THIS author's published stations ("own stations"
// per the contract's subscription filter); following other npubs / #r-URL
// cross-user discovery comes later.
export const OWNER_NPUB =
  "npub1j9kztnc85ednd7ncqhe37ag0evnltn8z6wd84jfqx4ts4gn89gks0vxesa";
export const OWNER_PUBKEY =
  "916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d";

const D_PREFIX = "airplay:station:";

/** ICY headers a stream advertises. All optional: plenty of servers state none. */
export interface StationHarvest {
  icyName?: string;
  genre?: string;
  bitrate?: number;
  homepage?: string;
  fmt?: string;
  /** Unix seconds of the probe — stale is distinguishable from absent. */
  probedAt: number;
}

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
  /** Optional human description — the station.v1 event *content* (plain text).
   *  Feed-authoritative like the podcast harvest; absent on bare follows. */
  description: string | null;
  /** What the STREAM advertised on the last tune-in (U4.5) — replaced wholesale by
   *  each probe, and never mixed into the user's own `name` / `tags` /
   *  `description`. Persisted, so a station's homepage and genre survive a restart
   *  instead of returning only after tuning in again. */
  harvest?: StationHarvest;
  /** Relay-sourced only: the id of the kind:31241 event this row came from, so an
   *  unfollow can name it in an `e` tag as well as the `a` coordinate. Absent for
   *  seed / local-store rows, which were never published. Never persisted — the
   *  Rust store's Station struct has no such field, so it drops on the way in. */
  eventId?: string;
}

/** Parse an imported JSON array into Stations — accepts the app's own export
 *  shape or a minimal `[{name,url}]`; a missing slug is derived from the name and
 *  descriptive fields default. Entries without a url/slug are dropped. Shared by
 *  the Stations-tab import and the app-level Backup/Restore router. */
export function parseStationsJson(data: unknown): Station[] {
  if (!Array.isArray(data)) throw new Error("expected a JSON array of stations");
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const url = String(r.url ?? "").trim();
      const name = String(r.name ?? "").trim() || url;
      const slug = String(r.slug ?? "").trim() || slugify(name);
      return {
        slug,
        name,
        url,
        fmt: r.fmt != null ? String(r.fmt) : null,
        bitrate: Number.isFinite(Number(r.bitrate)) ? Number(r.bitrate) : null,
        tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
        description: r.description != null ? String(r.description) : null,
      };
    })
    .filter((s) => s.url && s.slug);
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
  return addressOf(ev, STATION_KIND);
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
    description: ev.content?.trim() || null,
    eventId: ev.id,
  };
}

/**
 * Resolve a raw event stream into the displayable station list: keep only
 * `ownerPubkey`'s stations, drop any the owner deleted (unless re-published
 * since), dedupe replaceables by address keeping latest created_at, and skip
 * structurally-invalid records. Sorted by name.
 *
 * The NIP-09 / replaceable rules live in lib/addressable.ts, shared with shows —
 * see the note there for why they are not worth having two copies of.
 */
export function resolveStations(
  events: NostrEvent[],
  ownerPubkey: string,
): Station[] {
  return resolveAddressable(
    events,
    STATION_KIND,
    ownerPubkey,
    parseStation,
    (s) => s.name,
  );
}

/** What to show for a station, merging the user's own words with what the stream
 *  said about itself.
 *
 *  **The user always wins here** — the opposite of the podcast rule, and
 *  deliberately so: a podcast's `harvest` is the *publisher* describing their own
 *  show, while a station's is a stream banner, and the name you typed for a station
 *  is yours. So `icy-name` only fills a description you never wrote.
 *
 *  `live` is this session's probe when there is one; otherwise the persisted slice
 *  carries the answer, which is the point of storing it. */
export function stationIdentity(
  station: Station,
  live?: { name: string | null; genre: string | null; bitrate: number | null; homepage: string | null; fmt: string | null },
): { description: string | null; homepage: string | null; bitrate: number | null; genre: string | null } {
  const h = station.harvest;
  const icyName = live?.name ?? h?.icyName ?? null;
  const rawHomepage = live?.homepage ?? h?.homepage ?? null;
  return {
    description: station.description || icyName || null,
    homepage: rawHomepage
      ? rawHomepage.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : null,
    bitrate: station.bitrate ?? live?.bitrate ?? h?.bitrate ?? null,
    genre: live?.genre ?? h?.genre ?? null,
  };
}
