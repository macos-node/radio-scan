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

/** The key an event occupies in a live event map: addressable kinds collapse by
 *  coordinate (a re-publish REPLACES its predecessor), everything else — kind:5
 *  deletions — is distinct per event id. Shared by the live subscription and the
 *  post-publish refetch so both fold an event in the same way. */
export function streamKey(ev: NostrEvent, addressableKinds: number[]): string {
  return addressableKinds.includes(ev.kind) ? addressOf(ev, ev.kind) : ev.id;
}

/** Fold one event into a live map, keeping the newest per key. Returns true when
 *  the map changed, so a caller can skip recomputing on a duplicate — relays
 *  re-send the same event across a reconnect and a refetch overlaps the stream. */
export function ingestEvent(
  map: Map<string, NostrEvent>,
  ev: NostrEvent,
  addressableKinds: number[],
): boolean {
  const key = streamKey(ev, addressableKinds);
  const prev = map.get(key);
  if (prev && ev.created_at <= prev.created_at) return false;
  map.set(key, ev);
  return true;
}

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

/** Two live events for one thing — the signature of a stale publisher.
 *
 *  A follow is addressed by what it points at (decision #11), so **one target must
 *  have exactly one address**. Two events sharing an `r` (or, for shows, an `i`) are
 *  therefore never a legitimate state: they mean something published the same follow
 *  under a different `d`, which is what a device running an older build does. That
 *  happened on 2026-08-19 — a build five hours behind step 1 republished two follows
 *  as name-slugs, every relay accepted them, and the UI showed them as ordinary
 *  follows. It was caught only because the expected addresses had been computed by
 *  hand in advance.
 *
 *  This is the check that needs no foreknowledge, and it works on events already
 *  published — which a format marker cannot, since a build predating the marker
 *  cannot emit one. Returns the addresses that are superseded: for each duplicated
 *  target, every address except the newest event's.
 */
export function supersededAddresses(
  events: NostrEvent[],
  kind: number,
  ownerPubkey: string,
): Map<string, string> {
  // target -> [{ address, created_at }]
  const byTarget = new Map<string, { address: string; at: number }[]>();
  for (const ev of events) {
    if (ev.kind !== kind || ev.pubkey !== ownerPubkey) continue;
    const address = addressOf(ev, kind);
    // `i` (a publisher-stated id) outranks `r` (a location) for the same reason
    // the address derivation prefers it: a feed can move host.
    const i = ev.tags.find((t) => t[0] === "i")?.[1];
    const r = ev.tags.find((t) => t[0] === "r")?.[1];
    const target = i ?? r;
    if (!target) continue;
    const list = byTarget.get(target) ?? [];
    list.push({ address, at: ev.created_at });
    byTarget.set(target, list);
  }

  const superseded = new Map<string, string>();
  for (const [target, entries] of byTarget) {
    const addresses = new Set(entries.map((e) => e.address));
    if (addresses.size < 2) continue; // one address per target: nothing to report
    const newest = entries.reduce((a, b) => (b.at > a.at ? b : a));
    for (const e of entries) {
      if (e.address !== newest.address) superseded.set(e.address, target);
    }
  }
  return superseded;
}
