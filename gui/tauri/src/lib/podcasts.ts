// Shared podcast-subscription store + import/export serialization. The Podcasts
// tab and the app-level Backup/Restore both go through here, so a restore made
// from the header reflects in an open Podcasts tab (a lightweight window event
// nudges it to re-read — same-document localStorage writes don't fire `storage`).

export interface Sub {
  url: string;
  title: string;
  /** Set when the feed is served from a Nostr npub (see detectNpub). */
  npub?: string;
}

export const PODCASTS_KEY = "ntune.podcasts";
/** Dispatched after a programmatic subs write so a mounted Podcasts tab re-reads. */
export const PODCASTS_EVENT = "ntune:podcasts-changed";

export function loadSubs(): Sub[] {
  try {
    return JSON.parse(localStorage.getItem(PODCASTS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSubs(subs: Sub[]): void {
  localStorage.setItem(PODCASTS_KEY, JSON.stringify(subs));
}

/** Save + notify — for writes OUTSIDE the Podcasts tab (Backup restore) so the
 *  tab, if open, re-syncs. */
export function setPodcasts(subs: Sub[]): void {
  saveSubs(subs);
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
