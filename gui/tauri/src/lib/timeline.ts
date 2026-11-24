// The Home tab's "what's new": every subscribed feed's episodes merged into one
// list, newest first, grouped by day. Pure — the component feeds it the cache.
//
// Why episodes and not shows: the Podcasts tab's 2w/1w/1d switch filters SHOWS by
// their newest episode, and most shows are weekly, so 1w and 2w list the same
// shows (22 vs 24 on 2026-11-09). Counted as episodes the ranges differ (65 vs 110).

import type { Episode, Podcast } from "./tauri";

/** Home's range switch, in days. */
export type HomeRange = 1 | 7 | 14;

export function isHomeRange(v: unknown): v is HomeRange {
  return v === 1 || v === 7 || v === 14;
}

const DAY = 86_400;

/** A feed's episodes as stated in a far-future pubDate would sit at the top for
 *  ever; allow a little clock skew and drop the rest. */
const FUTURE_SLACK = DAY;

export interface Entry {
  feedUrl: string;
  show: string;
  ep: Episode;
  /** Ledger key — see `entryKey`. */
  key: string;
  /** Unix seconds; never null here (undated episodes can't be placed). */
  at: number;
}

/** One feed as Home sees it. `title` prefers the subscription's own name. */
export interface FeedIn {
  url: string;
  title: string;
  pod: Podcast | undefined;
}

/** Episode ids are only unique within a feed. */
export function entryKey(feedUrl: string, epId: string): string {
  return `${feedUrl}\n${epId}`;
}

/** Every dated episode published within the last `days`, newest first. Ties (a
 *  feed that stamps a whole batch with one time) keep feed order, which is the
 *  feed's own newest-first. */
export function buildTimeline(feeds: FeedIn[], now: number, days: number): Entry[] {
  const from = now - days * DAY;
  const out: Entry[] = [];
  for (const f of feeds) {
    if (!f.pod) continue;
    const show = f.title || f.pod.title;
    for (const ep of f.pod.episodes) {
      const at = ep.publishedAt;
      if (at == null || at < from || at > now + FUTURE_SLACK) continue;
      out.push({ feedUrl: f.url, show, ep, key: entryKey(f.url, ep.id), at });
    }
  }
  // Array.prototype.sort is stable, so equal stamps keep their feed order.
  return out.sort((a, b) => b.at - a.at);
}

/** A run of one show's episodes on one day, folded into a single row. Some feeds
 *  are really track feeds — a dub label posts ~33 tracks a day, all stamped
 *  midnight — and listed one per line they bury everything else. */
export const FOLD_MIN = 4;

export type Row =
  | { kind: "one"; entry: Entry }
  | { kind: "fold"; feedUrl: string; show: string; entries: Entry[] };

export interface DayGroup {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  label: string;
  rows: Row[];
}

function localDay(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayLabel(day: string, now: number): string {
  if (day === localDay(now)) return "Today";
  if (day === localDay(now - DAY)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Group a newest-first timeline by local day. Within a day, a show with
 *  FOLD_MIN or more episodes becomes one fold row, placed where its newest
 *  episode would have been. */
export function groupByDay(entries: Entry[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  let i = 0;
  while (i < entries.length) {
    const day = localDay(entries[i].at);
    const sameDay: Entry[] = [];
    while (i < entries.length && localDay(entries[i].at) === day) sameDay.push(entries[i++]);

    const perShow = new Map<string, Entry[]>();
    for (const e of sameDay) {
      const list = perShow.get(e.feedUrl);
      if (list) list.push(e);
      else perShow.set(e.feedUrl, [e]);
    }
    const rows: Row[] = [];
    const folded = new Set<string>();
    for (const e of sameDay) {
      const list = perShow.get(e.feedUrl)!;
      if (list.length < FOLD_MIN) {
        rows.push({ kind: "one", entry: e });
      } else if (!folded.has(e.feedUrl)) {
        folded.add(e.feedUrl);
        rows.push({ kind: "fold", feedUrl: e.feedUrl, show: e.show, entries: list });
      }
    }
    groups.push({ day, label: dayLabel(day, now), rows });
  }
  return groups;
}

// --- "new since you last looked" -------------------------------------------
//
// No feed says when an episode reached YOU, only when it was published — and a
// feed can post an episode back-dated, or a rescan can pick up last week's late
// post. So ntune keeps its own record of when each recent episode was first seen.

/** Short stable key for an episode id — the record lives in settings.json, and
 *  ids are often whole URLs. FNV-1a, 32-bit, base 36. A collision only costs a
 *  missed dot on one episode. */
export function epHash(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** feedUrl → (epHash → unix seconds first seen; 0 = present at baseline). A feed
 *  missing from the map hasn't been baselined: its current episodes are recorded
 *  as old, so subscribing to a show — or the very first run — doesn't light up
 *  its whole back catalogue. */
export type Ledger = Record<string, Record<string, number>>;

export const EMPTY_LEDGER: Ledger = {};

/** Only episodes this recent are recorded: the widest range is 2 weeks. */
const RECORD_WINDOW = 15 * DAY;

export function parseLedger(raw: string | null): Ledger {
  if (!raw) return EMPTY_LEDGER;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY_LEDGER;
    const out: Ledger = {};
    for (const [url, eps] of Object.entries(v)) {
      if (!eps || typeof eps !== "object" || Array.isArray(eps)) continue;
      const m: Record<string, number> = {};
      for (const [k, t] of Object.entries(eps)) if (typeof t === "number") m[k] = t;
      out[url] = m;
    }
    return out;
  } catch {
    return EMPTY_LEDGER;
  }
}

/** Record every recent episode in the loaded feeds. Returns the SAME object when
 *  nothing changed, so a caller can skip the write.
 *
 *  A loaded feed's record is rebuilt from its current recent episodes, so an
 *  episode that ages out of the window is forgotten — it can't come back as new,
 *  since only recent ones are recorded. A feed not loaded yet is left as it is:
 *  absence from the cache is not absence from the feed. A feed no longer
 *  subscribed is dropped. */
export function updateLedger(ledger: Ledger, feeds: FeedIn[], now: number): Ledger {
  // An empty list is "subscriptions not loaded yet", never "unsubscribed from
  // everything" — pruning on it would wipe the record.
  if (feeds.length === 0) return ledger;
  const out: Ledger = {};
  let changed = false;
  for (const f of feeds) {
    const prev = ledger[f.url];
    if (!f.pod) {
      if (prev) out[f.url] = prev;
      continue;
    }
    const baseline = prev === undefined;
    const next: Record<string, number> = {};
    let same = !baseline;
    for (const ep of f.pod.episodes) {
      const at = ep.publishedAt;
      if (at == null || at < now - RECORD_WINDOW) continue;
      const k = epHash(ep.id);
      if (k in next) continue;
      if (prev && k in prev) next[k] = prev[k];
      else {
        next[k] = baseline ? 0 : now;
        same = false;
      }
    }
    if (same && Object.keys(next).length !== Object.keys(prev).length) same = false;
    out[f.url] = same ? prev : next;
    if (!same) changed = true;
  }
  if (Object.keys(ledger).some((url) => !(url in out))) changed = true;
  return changed ? out : ledger;
}

/** First seen after `since` — i.e. new since the user last looked. */
export function isNew(ledger: Ledger, feedUrl: string, epId: string, since: number): boolean {
  const t = ledger[feedUrl]?.[epHash(epId)];
  return t !== undefined && t > since;
}

/** How many empty tiles complete the last row of a `cols`-wide grid holding `n`
 *  items: 0 when the row is already full, there are no items, or the column
 *  count isn't known yet (≤ 0). */
export function fillerCount(n: number, cols: number): number {
  if (n <= 0 || cols <= 0) return 0;
  return (cols - (n % cols)) % cols;
}
