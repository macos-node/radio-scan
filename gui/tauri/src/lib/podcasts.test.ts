import { describe, expect, it } from "vitest";
import {
  harvestOf,
  latestEpisodeAt,
  mergeSubs,
  parseHarvest,
  sortSubs,
  type Sub,
} from "./podcasts";

const sub = (url: string, title: string, latestAt?: number): Sub =>
  latestAt == null ? { url, title } : { url, title, latestAt };

const pod = (...dates: (number | null)[]) => ({
  episodes: dates.map((publishedAt) => ({ publishedAt })),
});

describe("latestEpisodeAt", () => {
  it("takes the max, not the first (feed order isn't guaranteed)", () => {
    expect(latestEpisodeAt(pod(100, 900, 300))).toBe(900);
  });
  it("ignores undated episodes and empty/absent feeds", () => {
    expect(latestEpisodeAt(pod(null, 500, null))).toBe(500);
    expect(latestEpisodeAt(pod())).toBeNull();
    expect(latestEpisodeAt(undefined)).toBeNull();
  });
});

describe("sortSubs", () => {
  const subs = [
    sub("a", "Zulu", 300),
    sub("b", "alpha", 900),
    sub("c", "Mike"), // never fetched — no known date
    sub("d", "bravo", 600),
  ];

  it("added: leaves the stored order alone", () => {
    expect(sortSubs(subs, "added").map((s) => s.url)).toEqual(["a", "b", "c", "d"]);
  });

  it("title: A–Z, case-insensitive", () => {
    expect(sortSubs(subs, "title").map((s) => s.title)).toEqual([
      "alpha",
      "bravo",
      "Mike",
      "Zulu",
    ]);
  });

  it("recent: newest first, undated last in stored order", () => {
    expect(sortSubs(subs, "recent").map((s) => s.url)).toEqual(["b", "d", "a", "c"]);
  });

  it("recent: a freshly fetched feed overrides the persisted stamp", () => {
    const fresh: Record<string, number> = { a: 5000 };
    const order = sortSubs(subs, "recent", (s) => fresh[s.url] ?? s.latestAt ?? null);
    expect(order.map((s) => s.url)).toEqual(["a", "b", "d", "c"]);
  });

  it("does not mutate the input", () => {
    const input = [...subs];
    sortSubs(input, "title");
    expect(input.map((s) => s.url)).toEqual(["a", "b", "c", "d"]);
  });

  it("holds stored order when nothing has a date yet (first paint)", () => {
    const cold = [sub("a", "Zulu"), sub("b", "alpha"), sub("c", "Mike")];
    expect(sortSubs(cold, "recent").map((s) => s.url)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeSubs", () => {
  const stored: Sub[] = [
    { url: "a", title: "Alpha", latestAt: 900 },
    { url: "b", title: "Bravo", latestAt: 600 },
  ];

  it("incoming wins on title + order, deduped by url", () => {
    const merged = mergeSubs(stored, [
      { url: "b", title: "Bravo (renamed)" },
      { url: "c", title: "Charlie" },
    ]);
    expect(merged.map((s) => [s.url, s.title])).toEqual([
      ["b", "Bravo (renamed)"],
      ["c", "Charlie"],
      ["a", "Alpha"],
    ]);
  });

  it("an import without latestAt keeps the harvested stamp", () => {
    // An old export / OPML file has nowhere to carry the date; it must not wipe
    // one we already derived, or Recent order goes flat until every feed refetches.
    const merged = mergeSubs(stored, [
      { url: "a", title: "Alpha" },
      { url: "b", title: "Bravo" },
    ]);
    expect(merged.map((s) => s.latestAt)).toEqual([900, 600]);
  });

  it("an incoming latestAt still wins (a fetch/newer export is authoritative)", () => {
    const merged = mergeSubs(stored, [{ url: "a", title: "Alpha", latestAt: 5000 }]);
    expect(merged[0].latestAt).toBe(5000);
  });

  it("adds unknown feeds with no stamp at all", () => {
    const merged = mergeSubs(stored, [{ url: "z", title: "Zulu" }]);
    expect(merged.find((s) => s.url === "z")?.latestAt).toBeUndefined();
  });
});

describe("mergeSubs — the harvest slice", () => {
  const harvested: Sub[] = [
    { url: "a", title: "Alpha", latestAt: 900, guid: "guid-a" },
    { url: "b", title: "Bravo", latestAt: 600 },
  ];

  it("an OPML/old import keeps both harvested fields", () => {
    const merged = mergeSubs(harvested, [
      { url: "a", title: "Alpha" },
      { url: "b", title: "Bravo" },
    ]);
    expect(merged.map((s) => [s.latestAt, s.guid])).toEqual([
      [900, "guid-a"],
      [600, undefined],
    ]);
  });

  it("an incoming guid wins (a re-fetch is authoritative)", () => {
    const merged = mergeSubs(harvested, [
      { url: "a", title: "Alpha", guid: "guid-a-moved" },
    ]);
    expect(merged[0].guid).toBe("guid-a-moved");
  });

  it("a feed with no guid anywhere simply has none", () => {
    const merged = mergeSubs(harvested, [{ url: "z", title: "Zulu" }]);
    expect(merged.find((s) => s.url === "z")?.guid).toBeUndefined();
  });
});

describe("harvestOf — the feed's own account of itself", () => {
  const feed = {
    author: "Adam Curry",
    ownerEmail: "adam@curry.com",
    website: "http://noagendashow.net",
    categories: ["News", "Politics"],
    language: "en",
    copyright: null,
    image: "https://example.com/art.jpg",
    description: "Deconstructing media",
  };

  it("keeps what the feed states", () => {
    const h = harvestOf(feed, 1_787_000_000);
    expect(h).toEqual({
      author: "Adam Curry",
      ownerEmail: "adam@curry.com",
      website: "http://noagendashow.net",
      categories: ["News", "Politics"],
      language: "en",
      image: "https://example.com/art.jpg",
      description: "Deconstructing media",
      fetchedAt: 1_787_000_000,
    });
  });

  it("drops what it does not — absent must not become empty string", () => {
    // "not stated" and "stated as blank" have to stay distinguishable, or the
    // merge and the export both start lying.
    const bare = harvestOf(
      {
        author: null,
        ownerEmail: null,
        website: null,
        categories: [],
        language: null,
        copyright: null,
        image: null,
        description: null,
      },
      42,
    );
    expect(bare).toEqual({ fetchedAt: 42 });
    expect("author" in bare).toBe(false);
  });

  it("copies categories rather than aliasing the feed's array", () => {
    const h = harvestOf(feed, 1);
    h.categories?.push("Mutated");
    expect(feed.categories).toEqual(["News", "Politics"]);
  });
});

describe("parseHarvest — importing a harvest slice", () => {
  it("round-trips what harvestOf produced", () => {
    const h = harvestOf(
      {
        author: "A",
        ownerEmail: null,
        website: null,
        categories: ["X"],
        language: "en",
        copyright: null,
        image: null,
        description: null,
      },
      99,
    );
    expect(parseHarvest(JSON.parse(JSON.stringify(h)))).toEqual(h);
  });

  it("treats a pre-U4.5 export (no harvest at all) as absent", () => {
    expect(parseHarvest(undefined)).toBeUndefined();
    expect(parseHarvest(null)).toBeUndefined();
    expect(parseHarvest("nonsense")).toBeUndefined();
  });

  it("treats a slice with only a timestamp as absent — it states nothing", () => {
    expect(parseHarvest({ fetchedAt: 123 })).toBeUndefined();
  });

  it("ignores fields of the wrong type rather than importing junk", () => {
    const h = parseHarvest({ author: 42, language: "en", categories: "News", fetchedAt: 7 });
    expect(h).toEqual({ language: "en", fetchedAt: 7 });
  });
});

describe("mergeSubs — the harvest slice survives an import", () => {
  it("an OPML/pre-U4.5 import keeps the stored identity", () => {
    const stored: Sub[] = [
      {
        url: "a",
        title: "Alpha",
        harvest: { author: "A", fetchedAt: 100 },
      },
    ];
    const merged = mergeSubs(stored, [{ url: "a", title: "Alpha" }]);
    expect(merged[0].harvest).toEqual({ author: "A", fetchedAt: 100 });
  });

  it("an incoming harvest wins — a newer export is authoritative", () => {
    const stored: Sub[] = [{ url: "a", title: "Alpha", harvest: { author: "Old", fetchedAt: 1 } }];
    const merged = mergeSubs(stored, [
      { url: "a", title: "Alpha", harvest: { author: "New", fetchedAt: 2 } },
    ]);
    expect(merged[0].harvest?.author).toBe("New");
  });
});
