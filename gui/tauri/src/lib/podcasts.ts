// Shared podcast-subscription store + import/export serialization. The Podcasts
// tab and the app-level Backup/Restore both go through here, so a restore made
// from the header reflects in an open Podcasts tab (a lightweight window event
// nudges it to re-read — same-document localStorage writes don't fire `storage`).
//
// DURABILITY: subscriptions persist in Rust (`podcasts.json`, a synchronous
// `std::fs::write`), NOT webview localStorage. WebView2 only flushes localStorage
// on a graceful shutdown, so a crash / force-kill / OS sign-out / the tray "Quit"
// silently dropped every unflushed change — imported podcasts vanished on reopen
// while file-backed stations survived (docs/podcast-persistence-2026-08-11.md).
// A sync in-memory `cache` fronts the async Rust store so the existing sync
// callers (loadSubs) keep working; localStorage is kept only as the one-time
// migration source and a same-session fallback until initSubs() has run.

import { invoke } from "@tauri-apps/api/core";

/** Channel-level identity exactly as the feed stated it (U4.5).
 *
 *  Every field optional: feeds omit most of these, and "not stated" must stay
 *  distinguishable from "stated as blank" for the merge and for export. Replaced
 *  wholesale on every fetch — the feed always wins — which is only safe because
 *  user-authored values live in their own slice. */
export interface Harvest {
  author?: string;
  ownerEmail?: string;
  website?: string;
  categories?: string[];
  language?: string;
  copyright?: string;
  /** Cover-art URL: stored, deliberately not rendered (the U4 decision). */
  image?: string;
  description?: string;
  /** Unix seconds — when this slice was taken, so stale is distinguishable from absent. */
  fetchedAt: number;
}

export interface Sub {
  url: string;
  title: string;
  /** Set when the feed is served from a Nostr npub (see detectNpub). */
  npub?: string;
  /** Harvested: the feed's `<podcast:guid>` when it carries one — the show's
   *  URL-independent identity (show.v1's NIP-73 `i` tag, U4.5's podcast key).
   *  A feed URL is not stable: podbean serves the same document from two
   *  hostnames, which is how one show ended up listed twice. */
  guid?: string;
  /** The feed's own account of itself (author, categories, language, …). Persisted
   *  here — not just in the feed-cache — because THIS is the store that gets
   *  exported and carried between machines; the cache is a cache, and is excluded
   *  from backups by design. */
  harvest?: Harvest;
  /** Harvested: unix seconds of the newest episode seen in this feed. Persisted
   *  so "recently updated" ordering is already right on the first paint, before
   *  the feeds re-fetch. Harvest, not user data — every fetch overwrites it
   *  (the feed always wins). */
  latestAt?: number;
}

/** Legacy webview key — now only a migration source + pre-init fallback mirror. */
export const PODCASTS_KEY = "ntune.podcasts";
/** Dispatched after a programmatic subs write so a mounted Podcasts tab re-reads. */
export const PODCASTS_EVENT = "ntune:podcasts-changed";

/** Sync view of the durable store, populated by initSubs(); null until then. */
let cache: Sub[] | null = null;

function readLocalStorage(): Sub[] {
  try {
    return JSON.parse(localStorage.getItem(PODCASTS_KEY) || "[]");
  } catch {
    return [];
  }
}

/** Current subscriptions (sync). Returns the durable cache once initSubs() has
 *  run; before that, the legacy localStorage mirror so the first paint isn't
 *  empty. */
export function loadSubs(): Sub[] {
  return cache ?? readLocalStorage();
}

/** Persist subscriptions to the durable Rust store (`podcasts.json`) and mirror
 *  to localStorage. The Rust write hits disk synchronously, so nothing is lost on
 *  a non-graceful exit. */
export function saveSubs(subs: Sub[]): void {
  cache = subs;
  localStorage.setItem(PODCASTS_KEY, JSON.stringify(subs)); // offline mirror / fallback
  void invoke("save_local_podcasts", { subs }).catch((e) =>
    console.error("save_local_podcasts failed", e),
  );
}

/** Save + notify — for writes OUTSIDE the Podcasts tab (Backup restore) so the
 *  tab, if open, re-syncs. */
export function setPodcasts(subs: Sub[]): void {
  saveSubs(subs);
  window.dispatchEvent(new Event(PODCASTS_EVENT));
}

/** Load the durable store once at startup, migrating any legacy localStorage
 *  subs on the first launch after the Rust store landed. Idempotent; dispatches
 *  PODCASTS_EVENT so a mounted Podcasts tab re-reads the now-authoritative list. */
export async function initSubs(): Promise<void> {
  let stored: Sub[] = [];
  try {
    stored = await invoke<Sub[]>("list_local_podcasts");
  } catch (e) {
    console.error("list_local_podcasts failed", e);
  }
  if (stored.length > 0) {
    cache = stored;
  } else {
    const legacy = readLocalStorage();
    if (legacy.length > 0) {
      // First launch after the fix: migrate localStorage → the durable store.
      cache = legacy;
      try {
        await invoke("save_local_podcasts", { subs: legacy });
      } catch (e) {
        console.error("podcast migration failed", e);
      }
    } else {
      cache = [];
    }
  }
  localStorage.setItem(PODCASTS_KEY, JSON.stringify(cache));
  window.dispatchEvent(new Event(PODCASTS_EVENT));
}

const NPUB_RE = /npub1[a-z0-9]{58}/i;

/** A feed served from a Nostr npub — e.g. the castr.me bridge
 *  (`castr.me/npub1…/rss.xml`) that turns a npub's audio events into a podcast
 *  RSS. Detected on import so these subs are tagged now and can later upgrade
 *  from the RSS bridge to native per-npub `1063` reading (ntune U4b) — same
 *  npub, better source. Today they still import + play as ordinary RSS. */
export function detectNpub(url: string): string | undefined {
  return url.match(NPUB_RE)?.[0].toLowerCase();
}

function mkSub(
  url: string,
  title: string,
  extra?: { npub?: string; latestAt?: number; guid?: string; harvest?: Harvest },
): Sub {
  const npub = detectNpub(url) ?? extra?.npub;
  const sub: Sub = { url, title };
  if (npub) sub.npub = npub;
  if (typeof extra?.latestAt === "number" && Number.isFinite(extra.latestAt))
    sub.latestAt = extra.latestAt;
  if (extra?.guid) sub.guid = extra.guid;
  if (extra?.harvest) sub.harvest = extra.harvest;
  return sub;
}

/** Parse an OPML subscription list (the universal feed-reader export) into subs.
 *  `querySelectorAll` recurses, so category groups flatten; every outline with an
 *  xmlUrl is a feed. */
export function parseOpml(xml: string): Sub[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("not valid OPML/XML");
  const out: Sub[] = [];
  doc.querySelectorAll("outline[xmlUrl]").forEach((o) => {
    const url = (o.getAttribute("xmlUrl") || "").trim();
    if (!url) return;
    const title = (o.getAttribute("text") || o.getAttribute("title") || url).trim();
    out.push(mkSub(url, title));
  });
  return out;
}

/** Parse the app's JSON export shape: [{url, title?, npub?, latestAt?, guid?}]. */
export function parseSubsJson(data: unknown): Sub[] {
  if (!Array.isArray(data)) throw new Error("expected a JSON array of feeds");
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const url = String(r.url ?? "").trim();
      const title = String(r.title ?? "").trim() || url;
      return mkSub(url, title, {
        npub: typeof r.npub === "string" ? r.npub : undefined,
        latestAt: typeof r.latestAt === "number" ? r.latestAt : undefined,
        guid: typeof r.guid === "string" ? r.guid : undefined,
        harvest: parseHarvest(r.harvest),
      });
    })
    .filter((s) => s.url);
}

/** Read a harvest slice out of imported JSON, keeping only what it actually
 *  states. An entry without one is not an error — every export written before
 *  U4.5, and every OPML file ever, has none. */
export function parseHarvest(raw: unknown): Harvest | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const h: Harvest = {
    fetchedAt: typeof r.fetchedAt === "number" ? r.fetchedAt : 0,
  };
  if (str(r.author)) h.author = String(r.author);
  if (str(r.ownerEmail)) h.ownerEmail = String(r.ownerEmail);
  if (str(r.website)) h.website = String(r.website);
  if (str(r.language)) h.language = String(r.language);
  if (str(r.copyright)) h.copyright = String(r.copyright);
  if (str(r.image)) h.image = String(r.image);
  if (str(r.description)) h.description = String(r.description);
  if (Array.isArray(r.categories)) {
    const cats = r.categories.filter((c): c is string => typeof c === "string");
    if (cats.length > 0) h.categories = cats;
  }
  // A slice with nothing but a timestamp says nothing — treat it as absent.
  return Object.keys(h).length > 1 ? h : undefined;
}

/** The harvest slice for a freshly fetched feed. `null`/empty fields are dropped
 *  so "not stated" round-trips as absent rather than as an empty string. */
export function harvestOf(
  pod: {
    author: string | null;
    ownerEmail: string | null;
    website: string | null;
    categories: string[];
    language: string | null;
    copyright: string | null;
    image: string | null;
    description: string | null;
  },
  fetchedAt: number,
): Harvest {
  const h: Harvest = { fetchedAt };
  if (pod.author) h.author = pod.author;
  if (pod.ownerEmail) h.ownerEmail = pod.ownerEmail;
  if (pod.website) h.website = pod.website;
  if (pod.language) h.language = pod.language;
  if (pod.copyright) h.copyright = pod.copyright;
  if (pod.image) h.image = pod.image;
  if (pod.description) h.description = pod.description;
  if (pod.categories.length > 0) h.categories = [...pod.categories];
  return h;
}

/** Serialize subs as OPML 1.1 — portable to any feed reader / podcast app. */
export function buildOpml(subs: Sub[], title = "ntune podcasts"): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="1.1">',
    `  <head><title>${esc(title)}</title></head>`,
    "  <body>",
    ...subs.map(
      (s) => `    <outline type="rss" text="${esc(s.title)}" xmlUrl="${esc(s.url)}"/>`,
    ),
    "  </body>",
    "</opml>",
    "",
  ].join("\n");
}

/** Merge incoming subs into existing, deduped by url (incoming wins, first).
 *
 *  One exception: the **harvest** fields (`latestAt`, `guid`) are not user data, so
 *  an incoming entry that lacks them inherits what we already derived rather than
 *  wiping it.
 *  Without that, restoring any export written before the field existed — or one
 *  from another app / an OPML file, which has nowhere to carry it — reset every
 *  feed's newest-episode date and the "Recent" order went flat until each feed
 *  refetched. Same rule as the rest of the harvest slice: a fetch overwrites it
 *  freely (the feed always wins), but an import only gap-fills. */
export function mergeSubs(existing: Sub[], incoming: Sub[]): Sub[] {
  const seen = new Set<string>();
  const fresh = incoming.filter((s) =>
    s.url && !seen.has(s.url) ? (seen.add(s.url), true) : false,
  );
  const prevByUrl = new Map(existing.map((s) => [s.url, s]));
  const urls = new Set(fresh.map((s) => s.url));
  return [
    ...fresh.map((s) => {
      const prev = prevByUrl.get(s.url);
      if (!prev) return s;
      const latestAt = s.latestAt ?? prev.latestAt;
      const guid = s.guid ?? prev.guid;
      const harvest = s.harvest ?? prev.harvest;
      if (latestAt === s.latestAt && guid === s.guid && harvest === s.harvest)
        return s;
      const merged: Sub = { ...s };
      if (latestAt != null) merged.latestAt = latestAt;
      if (guid) merged.guid = guid;
      if (harvest) merged.harvest = harvest;
      return merged;
    }),
    ...existing.filter((s) => !urls.has(s.url)),
  ];
}

/** How the Podcasts tab orders the list. `recent` = newest episode first (the
 *  default: a feed that just published rises to the top); `title` = A–Z;
 *  `added` = the stored order, newest subscription first. Display-only — the
 *  stored order is never rewritten, so `added` always survives. */
export type PodcastSort = "recent" | "title" | "added";

export function isPodcastSort(v: unknown): v is PodcastSort {
  return v === "recent" || v === "title" || v === "added";
}

/** Newest episode date in a fetched feed, in unix seconds. Feeds are usually
 *  newest-first but that isn't guaranteed, so take the max rather than [0]. */
export function latestEpisodeAt(
  pod: { episodes: { publishedAt: number | null }[] } | undefined,
): number | null {
  if (!pod) return null;
  let max: number | null = null;
  for (const ep of pod.episodes) {
    if (ep.publishedAt != null && (max == null || ep.publishedAt > max))
      max = ep.publishedAt;
  }
  return max;
}

/** Order subs for display. `latestOf` resolves a sub's newest-episode time —
 *  the caller passes the freshly fetched feed when it has one, falling back to
 *  the persisted `latestAt`. Feeds with no known date sort last, keeping their
 *  stored order (Array#sort is stable), so an unfetched list never scrambles. */
export function sortSubs(
  subs: Sub[],
  mode: PodcastSort,
  latestOf: (s: Sub) => number | null = (s) => s.latestAt ?? null,
): Sub[] {
  const out = [...subs];
  if (mode === "title") {
    out.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  } else if (mode === "recent") {
    out.sort((a, b) => {
      const x = latestOf(a);
      const y = latestOf(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }
  return out;
}
