import { describe, expect, it } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import { parseShow, resolveShows, SHOW_KIND } from "./show";
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
