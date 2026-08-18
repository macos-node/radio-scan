// The NIP-09-aware resolve shared by every addressable follow list ntune reads —
// station.v1 (31241) and show.v1 (31242) today, whatever comes next tomorrow.
//
// This is EXTRACTED, not duplicated. It encodes two rules that are easy to get
// subtly wrong and were only got right once:
//
//   1. A deletion voids events with `created_at <= its own` (NIP-09), so
//      re-publishing a follow after unfollowing it — same slug, later timestamp —
//      must NOT stay tombstoned. Keying deletions by their LATEST timestamp per
//      address is what makes unfollow → refollow work.
//   2. An addressable event is replaced, not appended: dedupe by address, keeping
//      the newest, or an edited follow shows up twice.
//
// A second copy of this logic would be a second chance to get either wrong.

import type { Event as NostrEvent } from "nostr-tools";

export const DELETE_KIND = 5; // NIP-09 deletion

/** The addressable coordinate `<kind>:<pubkey>:<d>` — the replaceable identity. */
export function addressOf(ev: NostrEvent, kind: number): string {
  const d = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
  return `${kind}:${ev.pubkey}:${d}`;
}

/**
 * Resolve a raw event stream into the live records of one addressable kind: keep
 * only `ownerPubkey`'s events, drop those the owner deleted (unless re-published
 * since), dedupe by address keeping the latest, and skip anything `parse` rejects
 * as structurally invalid. Sorted by `sortKey`.
 */
export function resolveAddressable<T>(
  events: NostrEvent[],
  kind: number,
  ownerPubkey: string,
  parse: (ev: NostrEvent) => T | null,
  sortKey: (item: T) => string,
): T[] {
  const deletedAt = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== DELETE_KIND || e.pubkey !== ownerPubkey) continue;
    for (const t of e.tags) {
      if (t[0] === "a" && t[1]?.startsWith(`${kind}:`)) {
        const prev = deletedAt.get(t[1]) ?? 0;
        if (e.created_at > prev) deletedAt.set(t[1], e.created_at);
      }
    }
  }

  const byAddr = new Map<string, { item: T; createdAt: number }>();
  for (const ev of events) {
    if (ev.kind !== kind || ev.pubkey !== ownerPubkey) continue;
    const address = addressOf(ev, kind);
    const delAt = deletedAt.get(address);
    // Suppress only if deleted and NOT re-published after the deletion.
    if (delAt !== undefined && ev.created_at <= delAt) continue;
    const item = parse(ev);
    if (item == null) continue;
    const prev = byAddr.get(address);
    if (!prev || ev.created_at > prev.createdAt) {
      byAddr.set(address, { item, createdAt: ev.created_at });
    }
  }

  return [...byAddr.values()]
    .map((v) => v.item)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
