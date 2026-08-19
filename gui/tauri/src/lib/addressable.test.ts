import { describe, it, expect } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import { DELETE_KIND, ingestEvent, streamKey } from "./addressable";

const PK = "a".repeat(64);
const ADDRESSABLE = [31241, 31242];

const ev = (
  over: Partial<NostrEvent> & { kind: number; created_at: number; id: string },
): NostrEvent =>
  ({
    pubkey: PK,
    tags: [],
    content: "",
    sig: "",
    ...over,
  }) as NostrEvent;

const follow = (kind: number, d: string, at: number, id: string) =>
  ev({ kind, created_at: at, id, tags: [["d", d]] });

describe("streamKey", () => {
  it("keys an addressable follow by coordinate, so a re-publish replaces it", () => {
    const a = follow(31242, "airplay:show:x", 10, "id1");
    const b = follow(31242, "airplay:show:x", 20, "id2");
    expect(streamKey(a, ADDRESSABLE)).toBe(streamKey(b, ADDRESSABLE));
  });

  it("keys a deletion by event id, so deletions accumulate", () => {
    const d1 = ev({ kind: DELETE_KIND, created_at: 10, id: "del1" });
    const d2 = ev({ kind: DELETE_KIND, created_at: 11, id: "del2" });
    expect(streamKey(d1, ADDRESSABLE)).toBe("del1");
    expect(streamKey(d2, ADDRESSABLE)).not.toBe(streamKey(d1, ADDRESSABLE));
  });

  it("does not collide a station and a show sharing a d value", () => {
    const st = follow(31241, "same", 10, "s1");
    const sh = follow(31242, "same", 10, "s2");
    expect(streamKey(st, ADDRESSABLE)).not.toBe(streamKey(sh, ADDRESSABLE));
  });
});

describe("ingestEvent", () => {
  it("accepts a newer event at the same address and reports the change", () => {
    const m = new Map<string, NostrEvent>();
    expect(ingestEvent(m, follow(31242, "d1", 10, "old"), ADDRESSABLE)).toBe(true);
    expect(ingestEvent(m, follow(31242, "d1", 20, "new"), ADDRESSABLE)).toBe(true);
    expect(m.size).toBe(1);
    expect([...m.values()][0].id).toBe("new");
  });

  it("ignores an older event and reports no change", () => {
    const m = new Map<string, NostrEvent>();
    ingestEvent(m, follow(31242, "d1", 20, "new"), ADDRESSABLE);
    expect(ingestEvent(m, follow(31242, "d1", 10, "old"), ADDRESSABLE)).toBe(false);
    expect([...m.values()][0].id).toBe("new");
  });

  it("reports no change when the same event arrives twice", () => {
    // The refetch overlaps the live stream, and relays re-send across a
    // reconnect — a duplicate must not trigger a recompute.
    const m = new Map<string, NostrEvent>();
    const e = follow(31241, "d1", 10, "same");
    expect(ingestEvent(m, e, ADDRESSABLE)).toBe(true);
    expect(ingestEvent(m, e, ADDRESSABLE)).toBe(false);
  });

  it("keeps deletions alongside the follows they void", () => {
    const m = new Map<string, NostrEvent>();
    ingestEvent(m, follow(31242, "d1", 10, "show"), ADDRESSABLE);
    ingestEvent(m, ev({ kind: DELETE_KIND, created_at: 11, id: "del" }), ADDRESSABLE);
    expect(m.size).toBe(2);
  });
});
