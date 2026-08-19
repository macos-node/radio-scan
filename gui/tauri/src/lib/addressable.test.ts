import { describe, it, expect } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import { DELETE_KIND, ingestEvent, streamKey,
  supersededAddresses,
} from "./addressable";

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

describe("supersededAddresses — a stale publisher's signature", () => {
  const PK = "916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d";
  const SHOW = 31242;
  const ev = (d: string, at: number, tags: string[][]) =>
    ({
      id: d,
      pubkey: PK,
      kind: SHOW,
      created_at: at,
      content: "",
      sig: "",
      tags: [["d", d], ...tags],
    }) as unknown as NostrEvent;

  it("says nothing when each target has one address", () => {
    const events = [
      ev("airplay:show:aaaa", 100, [["r", "https://a.example/f.xml"]]),
      ev("airplay:show:bbbb", 100, [["r", "https://b.example/f.xml"]]),
    ];
    expect(supersededAddresses(events, SHOW, PK).size).toBe(0);
  });

  it("flags the older address when one feed has two", () => {
    // Exactly the 2026-08-19 incident: a stale build republished under a name-slug.
    const events = [
      ev("airplay:show:the-peter-mccormack-show", 100, [["r", "https://acast/x"]]),
      ev("airplay:show:f5a81dadd784fbf5", 200, [["r", "https://acast/x"]]),
    ];
    const out = supersededAddresses(events, SHOW, PK);
    const stale = `${SHOW}:${PK}:airplay:show:the-peter-mccormack-show`;
    expect([...out.keys()]).toEqual([stale]);
    // Reported as a full addressable coordinate — what a retraction's `a` tag needs.
    expect(out.get(stale)).toBe("https://acast/x");
  });

  it("matches on the guid even when the two events disagree about the URL", () => {
    // podbean serves one feed from two hosts, so `r` alone would miss this.
    const events = [
      ev("airplay:show:old", 100, [
        ["r", "https://feed.podbean.com/z/feed.xml"],
        ["i", "podcast:guid:g-1"],
      ]),
      ev("airplay:show:new", 200, [
        ["r", "https://z.podbean.com/feed.xml"],
        ["i", "podcast:guid:g-1"],
      ]),
    ];
    expect([...supersededAddresses(events, SHOW, PK).keys()]).toEqual([
      `${SHOW}:${PK}:airplay:show:old`,
    ]);
  });

  it("keeps the newest, whatever order the events arrive in", () => {
    const events = [
      ev("airplay:show:new", 200, [["r", "https://x/y"]]),
      ev("airplay:show:old", 100, [["r", "https://x/y"]]),
    ];
    expect([...supersededAddresses(events, SHOW, PK).keys()]).toEqual([
      `${SHOW}:${PK}:airplay:show:old`,
    ]);
  });

  it("ignores another author's events and other kinds", () => {
    const mine = ev("airplay:show:mine", 100, [["r", "https://x/y"]]);
    const theirs = { ...ev("airplay:show:theirs", 200, [["r", "https://x/y"]]), pubkey: "ff".repeat(32) };
    const station = { ...ev("airplay:station:s", 200, [["r", "https://x/y"]]), kind: 31241 };
    expect(supersededAddresses([mine, theirs as NostrEvent, station as NostrEvent], SHOW, PK).size).toBe(0);
  });
});
