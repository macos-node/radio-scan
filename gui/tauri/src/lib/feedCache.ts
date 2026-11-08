// Feed bodies for this session, shared by every tab that reads podcast feeds
// (Podcasts, Home). Module-level so switching tabs doesn't refetch.

import type { Podcast } from "./tauri";

/** Parsed feeds by URL. Primed from the on-disk cache (Rust `feed-cache/`), so a
 *  tab paints from the last known state instead of a blank slate while every
 *  feed refetches. */
export const podCache: Record<string, Podcast> = {};

/** Feeds already refreshed from the network this session. A prefetch loop skips
 *  these rather than everything in `podCache` — otherwise a disk-primed entry
 *  would look fetched and the list would never see today's episodes. */
export const refreshed = new Set<string>();
