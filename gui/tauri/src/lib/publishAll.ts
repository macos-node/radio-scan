// Publishing a whole list at once (decision #11, step 3).
//
// WHAT IS PUBLISHED, and what deliberately is not: only rows this device holds
// locally that are not yet on the relays. A row that arrived FROM the relays is
// never re-asserted — the decision's open sub-question, settled as "no". A device
// publishes what a person did on it; re-publishing another device's entry would
// restamp an event nobody touched here, and would race a machine that had just
// unpublished it, resurrecting something someone else chose to remove.
//
// Paced on purpose. macOS measured hosts rate-limiting an unpaced 31-feed *read*
// sweep, and this writes to three relays per item; a burst is the one shape most
// likely to be refused. Sequential with a gap is slower and finishes.

export interface PublishOutcome<T> {
  published: number;
  failed: { item: T; error: string }[];
}

/** Publish each item in turn, pausing between them, never aborting the run for one
 *  failure — a single unreachable relay must not strand the rest of the list.
 *  `onProgress` fires before each attempt so a caller can show "3 / 9". */
export async function publishSequentially<T>(
  items: T[],
  publishOne: (item: T) => Promise<unknown>,
  opts: { delayMs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<PublishOutcome<T>> {
  const delayMs = opts.delayMs ?? 400;
  const out: PublishOutcome<T> = { published: 0, failed: [] };
  for (const [i, item] of items.entries()) {
    opts.onProgress?.(i, items.length);
    try {
      await publishOne(item);
      out.published += 1;
    } catch (e) {
      out.failed.push({ item, error: String(e) });
    }
    // No trailing pause: the gap protects the NEXT request, and there isn't one.
    if (i < items.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  opts.onProgress?.(items.length, items.length);
  return out;
}

/** How a finished run reads in the UI. Kept here so both tabs word it identically. */
export function describeOutcome<T>(o: PublishOutcome<T>): string {
  if (o.failed.length === 0) {
    return `published ${o.published}`;
  }
  if (o.published === 0) {
    return `none published — ${o.failed.length} failed`;
  }
  return `published ${o.published}, ${o.failed.length} failed`;
}
