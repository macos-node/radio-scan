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

export interface Sub {
  url: string;
  title: string;
  /** Set when the feed is served from a Nostr npub (see detectNpub). */
  npub?: string;
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

function mkSub(url: string, title: string, existingNpub?: string): Sub {
  const npub = detectNpub(url) ?? existingNpub;
  return npub ? { url, title, npub } : { url, title };
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

/** Parse the app's JSON export shape: [{url, title?, npub?}]. */
export function parseSubsJson(data: unknown): Sub[] {
  if (!Array.isArray(data)) throw new Error("expected a JSON array of feeds");
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const url = String(r.url ?? "").trim();
      const title = String(r.title ?? "").trim() || url;
      return mkSub(url, title, typeof r.npub === "string" ? r.npub : undefined);
    })
    .filter((s) => s.url);
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

/** Merge incoming subs into existing, deduped by url (incoming wins, first). */
export function mergeSubs(existing: Sub[], incoming: Sub[]): Sub[] {
  const seen = new Set<string>();
  const fresh = incoming.filter((s) =>
    s.url && !seen.has(s.url) ? (seen.add(s.url), true) : false,
  );
  const urls = new Set(fresh.map((s) => s.url));
  return [...fresh, ...existing.filter((s) => !urls.has(s.url))];
}
