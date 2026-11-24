// Cover-art loading for tiles. The Rust side does the real caching (on disk,
// shrunk — see src-tauri/src/art.rs); this is the session layer on top of it:
// one request per image URL however many tiles show it, at most `limit` in
// flight so a first launch doesn't open two dozen downloads at once, and a
// synchronous peek so a remounted tile paints its art without a flash.

import { podcastArt } from "./tauri";

export interface ArtCache {
  /** The art for `url`: a `data:` URI, or null when there is none (any error). */
  load(url: string): Promise<string | null>;
  /** The already-resolved result, or undefined if not loaded yet. */
  peek(url: string): string | null | undefined;
}

export function makeArtCache(fetchArt: (url: string) => Promise<string>, limit = 4): ArtCache {
  const pending = new Map<string, Promise<string | null>>();
  const done = new Map<string, string | null>();
  const waiting: (() => void)[] = [];
  let active = 0;

  // Reserve synchronously: a slot is taken the moment load() runs, and a
  // finished fetch hands its slot straight to the next waiter rather than
  // freeing it (which would let a new caller jump the queue).
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((r) => waiting.push(r));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return {
    peek: (url) => done.get(url),
    load(url) {
      const known = pending.get(url);
      if (known) return known;
      const p = (async () => {
        await acquire();
        try {
          return await fetchArt(url);
        } catch {
          return null;
        } finally {
          release();
        }
      })().then((v) => {
        done.set(url, v);
        return v;
      });
      pending.set(url, p);
      return p;
    },
  };
}

/** The app-wide cache, backed by the Rust `podcast_art` command. */
export const podcastArtCache = makeArtCache(podcastArt);
