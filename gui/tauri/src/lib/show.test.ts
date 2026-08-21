import { describe, expect, it } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import {
  followState,
  mergeFollows,
  syncCounts,
  type FollowState,
  parseShow,
  resolveShows,
  SHOW_KIND,
  type Show,
} from "./show";
import { resolveStations } from "./station";

const PK = "916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d";

const ev = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent =>
  ({
    id: "aa".repeat(32),
    pubkey: PK,
    created_at: 1_787_000_000,
    kind: SHOW_KIND,
    content: "",
    sig: "",
    ...over,
  }) as NostrEvent;

// The contract's own fixture, transcribed — No Agenda, with a real podcast:guid.
const NO_AGENDA = ev({
  id: "bb".repeat(32),
  content: "",
  tags: [
    ["d", "airplay:show:no-agenda-show"],
    ["name", "No Agenda Show"],
    ["r", "http://feed.nashownotes.com/rss.xml"],
    ["i", "podcast:guid:856cd618-7f34-57ea-9b84-3600f1f65e7f"],
    ["t", "talk"],
    ["alt", "A podcast followed in radio-scan"],
  ],
});

describe("parseShow", () => {
  it("reads the fixture's shape", () => {
    const s = parseShow(NO_AGENDA);
    expect(s).toMatchObject({
      slug: "no-agenda-show",
      title: "No Agenda Show",
      url: "http://feed.nashownotes.com/rss.xml",
      guid: "856cd618-7f34-57ea-9b84-3600f1f65e7f",
      tags: ["talk"],
      eventId: "bb".repeat(32),
    });
  });

  it("a show with no guid is still valid — 3 of 11 real feeds state none", () => {
    const s = parseShow(
      ev({
        tags: [
          ["d", "airplay:show:a-duck-in-a-tree"],
          ["name", "A Duck in a Tree"],
          ["r", "https://zovietfrance.podbean.com/feed.xml"],
        ],
      }),
    );
    expect(s?.slug).toBe("a-duck-in-a-tree");
    expect(s?.guid).toBeUndefined();
  });

  it("ignores an unrelated NIP-73 id — `i` is not ours by default", () => {
    const s = parseShow(
      ev({
        tags: [
          ["d", "airplay:show:x"],
          ["name", "X"],
          ["r", "https://example.com/f.xml"],
          ["i", "isbn:9780134190440"],
        ],
      }),
    );
    expect(s?.guid).toBeUndefined();
  });

  it("rejects a record missing d / name / r", () => {
    expect(parseShow(ev({ tags: [["d", "airplay:show:x"], ["name", "X"]] }))).toBeNull();
  });
});

describe("resolveShows", () => {
  const del = (slug: string, at: number): NostrEvent =>
    ev({
      id: "cc".repeat(32),
      kind: 5,
      created_at: at,
      tags: [["a", `${SHOW_KIND}:${PK}:airplay:show:${slug}`]],
    });
  const show = (slug: string, at: number) =>
    ev({
      created_at: at,
      tags: [
        ["d", `airplay:show:${slug}`],
        ["name", slug],
        ["r", `https://example.com/${slug}.xml`],
      ],
    });

  it("drops a deleted show but keeps one re-followed later", () => {
    const resolved = resolveShows(
      [show("gone", 100), del("gone", 200), show("back", 300), del("back", 200)],
      PK,
    );
    expect(resolved.map((s) => s.slug)).toEqual(["back"]);
  });

  it("does not confuse a station deletion with a show address", () => {
    // Both kinds ride one subscription now, and their `a` coordinates differ only
    // by the leading kind — a prefix mix-up would silently tombstone the wrong list.
    const stationDelete = ev({
      id: "dd".repeat(32),
      kind: 5,
      created_at: 999,
      tags: [["a", `31241:${PK}:airplay:show:keep`]],
    });
    expect(resolveShows([show("keep", 100), stationDelete], PK).map((s) => s.slug)).toEqual([
      "keep",
    ]);
  });

  it("shares one event stream with stations without cross-talk", () => {
    const station = ev({
      id: "ee".repeat(32),
      kind: 31241,
      created_at: 100,
      tags: [
        ["d", "airplay:station:acid-jazz"],
        ["name", "Acid Jazz"],
        ["r", "http://79.111.14.76:8000/acidjazz"],
      ],
    });
    const mixed = [station, show("duck", 100), del("duck", 200)];
    expect(resolveShows(mixed, PK)).toEqual([]);
    expect(resolveStations(mixed, PK).map((s) => s.slug)).toEqual(["acid-jazz"]);
  });
});

describe("mergeFollows", () => {
  const sub = (url: string, title: string, guid?: string) =>
    guid ? { url, title, guid } : { url, title };
  const show = (url: string, title: string, guid?: string): Show => ({
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    title,
    url,
    tags: [],
    description: null,
    eventId: "ff".repeat(32),
    ...(guid ? { guid } : {}),
  });

  it("matches by guid even when the URLs differ", () => {
    // The podbean case: one feed, two hostnames. URL matching alone lists it twice.
    const rows = mergeFollows(
      [sub("https://zovietfrance.podbean.com/feed.xml", "A Duck in a Tree", "g-duck")],
      [show("https://feed.podbean.com/zovietfrance/feed.xml", "A Duck in a Tree", "g-duck")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].show).toBeDefined();
    expect(rows[0].url).toBe("https://zovietfrance.podbean.com/feed.xml"); // local wins
  });

  it("falls back to URL for the feeds that state no guid", () => {
    const rows = mergeFollows(
      [sub("https://example.com/f.xml", "Example")],
      [show("https://example.com/f.xml", "Example")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].show).toBeDefined();
  });

  it("appends a follow published from another machine", () => {
    const rows = mergeFollows(
      [sub("https://a.example/f.xml", "Local only")],
      [show("https://b.example/g.xml", "Followed elsewhere", "g-b")],
    );
    expect(rows.map((r) => [r.title, !!r.relayOnly])).toEqual([
      ["Local only", false],
      ["Followed elsewhere", true],
    ]);
  });

  it("keeps local order and local harvest untouched", () => {
    const local = [
      { url: "u1", title: "One", latestAt: 900, guid: "g1" },
      { url: "u2", title: "Two", latestAt: 100 },
    ];
    const rows = mergeFollows(local, [show("u1", "One renamed upstream", "g1")]);
    expect(rows.map((r) => r.title)).toEqual(["One", "Two"]);
    expect(rows[0].latestAt).toBe(900);
  });

  it("does not claim one show for two subs", () => {
    const rows = mergeFollows(
      [sub("u1", "One", "g1"), sub("u2", "Two")],
      [show("u1", "One", "g1")],
    );
    expect(rows.filter((r) => r.show)).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });
});

describe("a relay-sourced show carries its own d", () => {
  it("keeps the event's `d` verbatim, so a retraction can name it", () => {
    // A follow published before decision #11: a name-derived slug that today's
    // rules would never compute. Losing it here is what made it unretractable.
    const ev = {
      kind: 31242,
      id: "ab".repeat(32),
      pubkey: "cd".repeat(32),
      created_at: 1,
      content: "",
      sig: "",
      tags: [
        ["d", "airplay:show:the-peter-mccormack-show"],
        ["name", "The Peter McCormack Show"],
        ["r", "https://feeds.acast.com/public/shows/69d4f193b76468caacc5068f"],
      ],
    } as unknown as Parameters<typeof parseShow>[0];
    const show = parseShow(ev)!;
    expect(show.d).toBe("airplay:show:the-peter-mccormack-show");
    expect(show.slug).toBe("the-peter-mccormack-show");
  });
});

describe("followState", () => {
  const show = (url: string): Show => ({
    slug: "s",
    title: "T",
    url,
    tags: [],
    description: null,
    eventId: "ff".repeat(32),
  });

  it("reads a subscription with a published follow as synced", () => {
    expect(followState({ url: "u", title: "T", show: show("u") })).toBe("synced");
  });

  it("reads a subscription with no follow as local-only", () => {
    expect(followState({ url: "u", title: "T" })).toBe("local-only");
  });

  it("reads a follow with no local subscription as relay-only", () => {
    // relayOnly implies published: the row was built out of the follow event.
    expect(followState({ url: "u", title: "T", show: show("u"), relayOnly: true })).toBe(
      "relay-only",
    );
  });

  it("classifies every row mergeFollows can produce", () => {
    // The fourth quadrant — neither here nor published — has no row to classify,
    // which is why callers can switch on three cases and stop.
    const rows = mergeFollows(
      [
        { url: "a", title: "Synced" },
        { url: "b", title: "Local only" },
      ],
      [show("a"), { ...show("c"), title: "Relay only", url: "c" }],
    );
    expect(rows.map((r) => [r.title, followState(r)])).toEqual([
      ["Synced", "synced"],
      ["Local only", "local-only"],
      ["Relay only", "relay-only"],
    ]);
  });
});

describe("syncCounts", () => {
  const show = (url: string): Show => ({
    slug: "s",
    title: "T",
    url,
    tags: [],
    description: null,
    eventId: "ff".repeat(32),
  });
  const rows = (...specs: FollowState[]) =>
    specs.map((s, i) => {
      const url = `u${i}`;
      if (s === "local-only") return { url, title: url };
      if (s === "synced") return { url, title: url, show: show(url) };
      return { url, title: url, show: show(url), relayOnly: true };
    });

  it("counts a row under both headings when it is both", () => {
    // A synced row is HERE and PUBLISHED — the two counts overlap by design, so
    // here + published does not add up to total and is not meant to.
    const c = syncCounts(rows("synced", "synced"));
    expect([c.total, c.here, c.published]).toEqual([2, 2, 2]);
    expect([c.notHere, c.notPublished]).toEqual([0, 0]);
    expect(c.inSync).toBe(true);
  });

  it("names both gaps separately", () => {
    const c = syncCounts(rows("synced", "local-only", "local-only", "relay-only"));
    expect(c).toEqual({
      total: 4,
      here: 3,
      published: 2,
      notHere: 1,
      notPublished: 2,
      inSync: false,
    });
  });

  it("is not in sync while anything is published but not pulled in", () => {
    expect(syncCounts(rows("synced", "relay-only")).inSync).toBe(false);
  });

  it("is not in sync while anything is held here but never shared", () => {
    expect(syncCounts(rows("synced", "local-only")).inSync).toBe(false);
  });

  it("does not call an empty list in sync", () => {
    // Convergence over nothing is not an answer; it is an unasked question.
    expect(syncCounts([]).inSync).toBe(false);
  });
});

describe("ghost rows", () => {
  const ghost = { url: "u", title: "Gone", ghost: true };

  it("classifies a ghost as its own state, not as local-only", () => {
    // Without the flag a ghost reads local-only — the one reading that is
    // actively wrong, since nothing local exists to read.
    expect(followState(ghost)).toBe("ghost");
  });

  it("leaves a ghost out of every count", () => {
    const c = syncCounts([
      { url: "a", title: "A", show: { slug: "a", title: "A", url: "a", tags: [], description: null } },
      ghost,
    ]);
    expect([c.total, c.here, c.published]).toEqual([1, 1, 1]);
    expect([c.notHere, c.notPublished]).toEqual([0, 0]);
  });

  it("does not let a ghost hold `in sync` hostage", () => {
    // The user retracted that follow deliberately. A tombstone must not read as
    // an unclosed gap, or the badge could never come back.
    const c = syncCounts([
      { url: "a", title: "A", show: { slug: "a", title: "A", url: "a", tags: [], description: null } },
      ghost,
    ]);
    expect(c.inSync).toBe(true);
  });

  it("is not in sync when the list holds nothing but ghosts", () => {
    expect(syncCounts([ghost]).inSync).toBe(false);
  });
});
