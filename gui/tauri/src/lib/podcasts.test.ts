import { beforeEach, describe, expect, it } from "vitest";
import {
  absorbPodcast,
  harvestOf,
  loadSubs,
  saveSubs,
  setEnrich,
  PODCASTS_EVENT,
  type AbsorbablePodcast,
  parseEnrich,
  parseSubsJson,
  podcastIdentity,
  latestEpisodeAt,
  mergeSubs,
  parseHarvest,
  sortSubs,
  type Enrich,
  type Harvest,
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

describe("export == persisted state — podcasts (U4.5 H3)", () => {
  // The podcast export writes `Sub` objects straight out, so the guard here is
  // that a full round-trip through the importer loses nothing.
  const full: Sub = {
    url: "https://serve.podhome.fm/rss/43a4f801",
    title: "Bitcoin And",
    npub: "npub1e0f808a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829a4b5c6",
    guid: "43a4f801-04a3-5897-bc32-9f905e163a36",
    latestAt: 1_787_000_000,
    harvest: {
      author: "David Bennett",
      ownerEmail: "david.bennett.c@gmail.com",
      website: "https://serve.podhome.fm/bitcoin-and-",
      categories: ["News"],
      language: "en",
      copyright: "All rights reserved",
      image: "https://assets.podhome.fm/art.jpg",
      description: "A daily bitcoin news podcast",
      fetchedAt: 1_787_100_000,
    },
  };

  it("round-trips every persisted field through import", () => {
    const back = parseSubsJson(JSON.parse(JSON.stringify([full])));
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(full);
  });

  it("keeps each key of the persisted shape", () => {
    const back = parseSubsJson(JSON.parse(JSON.stringify([full])))[0];
    for (const key of Object.keys(full)) expect(back).toHaveProperty(key);
  });

  it("a restore of that export re-merges without losing harvest", () => {
    // The realistic path: restore a backup over a store that already has the feed.
    const stored: Sub[] = [{ url: full.url, title: "Bitcoin And", latestAt: 1 }];
    const merged = mergeSubs(stored, parseSubsJson(JSON.parse(JSON.stringify([full]))));
    expect(merged).toHaveLength(1);
    expect(merged[0].harvest?.ownerEmail).toBe("david.bennett.c@gmail.com");
    expect(merged[0].guid).toBe(full.guid);
  });
});

describe("podcastIdentity — feed wins, the user fills gaps (U4.5 H4)", () => {
  const sub = (harvest?: Partial<Harvest>, enrich?: Partial<Enrich>): Sub => ({
    url: "u",
    title: "T",
    ...(harvest ? { harvest: { fetchedAt: 1, ...harvest } as Harvest } : {}),
    ...(enrich ? { enrich: { editedAt: 1, ...enrich } as Enrich } : {}),
  });

  it("shows the feed's value when it states one", () => {
    const id = podcastIdentity(sub({ author: "Feed Author" }, { author: "My Note" }));
    expect(id.author).toBe("Feed Author");
    expect(id.fromUser).toEqual([]);
  });

  it("shows the user's value only where the feed is silent", () => {
    const id = podcastIdentity(sub({ author: "Feed Author" }, { website: "https://mine" }));
    expect(id.author).toBe("Feed Author");
    expect(id.website).toBe("https://mine");
    expect(id.fromUser).toEqual(["website"]);
  });

  it("a just-fetched feed outranks the stored harvest", () => {
    const id = podcastIdentity(sub({ author: "Stored" }), { author: "Fresh" });
    expect(id.author).toBe("Fresh");
  });

  it("an empty feed array does not count as stated", () => {
    const id = podcastIdentity(sub({ categories: [] }, { categories: ["Mine"] }));
    expect(id.categories).toEqual(["Mine"]);
    expect(id.fromUser).toEqual(["categories"]);
  });

  it("a user value the feed now states goes DORMANT, not deleted", () => {
    // The doc's rule: hidden while the feed carries it, and still there if the
    // feed stops. Losing it would punish the user for the publisher's edit.
    const s = sub({ author: "Feed Author" }, { author: "My Note" });
    expect(podcastIdentity(s).author).toBe("Feed Author");
    expect(s.enrich?.author).toBe("My Note"); // still stored

    const feedWentQuiet = { ...s, harvest: { fetchedAt: 2 } as Harvest };
    expect(podcastIdentity(feedWentQuiet).author).toBe("My Note");
  });

  it("says nothing when neither slice does", () => {
    expect(podcastIdentity(sub())).toEqual({ fromUser: [] });
  });
});

describe("enrich survives what harvest does not", () => {
  const withBoth: Sub = {
    url: "u",
    title: "T",
    harvest: { author: "Feed", fetchedAt: 10 },
    enrich: { website: "https://mine", editedAt: 5 },
  };

  it("round-trips through export and import", () => {
    const back = parseSubsJson(JSON.parse(JSON.stringify([withBoth])));
    expect(back[0]).toEqual(withBoth);
  });

  it("an import that lacks both slices keeps the stored ones", () => {
    const merged = mergeSubs([withBoth], [{ url: "u", title: "T" }]);
    expect(merged[0].enrich).toEqual(withBoth.enrich);
    expect(merged[0].harvest).toEqual(withBoth.harvest);
  });

  it("parseEnrich ignores the harvest-only fields", () => {
    // image and fetchedAt belong to the feed's slice; a user slice claiming them
    // would blur the boundary the two-slice design exists to keep.
    const e = parseEnrich({ author: "A", image: "https://x/y.jpg", fetchedAt: 9, editedAt: 3 });
    expect(e).toEqual({ author: "A", editedAt: 3 });
  });
});

describe("funding + lightning address (U4.5 H5)", () => {
  const feed = {
    author: null,
    ownerEmail: null,
    website: null,
    categories: [],
    language: null,
    copyright: null,
    image: null,
    description: null,
    funding: { url: "https://fountain.fm/show/x/support", label: "Support the show" },
    valueAddress: { address: "danielprince@fountain.fm", name: "Daniel Prince", split: 98 },
  };

  it("carries both into the stored slice", () => {
    const h = harvestOf(feed, 100);
    expect(h.funding).toEqual(feed.funding);
    expect(h.valueAddress).toEqual(feed.valueAddress);
  });

  it("copies rather than aliasing the fetched objects", () => {
    const h = harvestOf(feed, 100);
    h.funding!.url = "https://mutated";
    expect(feed.funding.url).toBe("https://fountain.fm/show/x/support");
  });

  it("round-trips through export and import", () => {
    const sub: Sub = { url: "u", title: "T", harvest: harvestOf(feed, 100) };
    expect(parseSubsJson(JSON.parse(JSON.stringify([sub])))[0]).toEqual(sub);
  });

  it("rejects funding with no url and a value with no address", () => {
    const h = parseHarvest({
      author: "A",
      funding: { label: "Support us" },
      valueAddress: { name: "Nobody", split: 100 },
      fetchedAt: 1,
    });
    expect(h?.funding).toBeUndefined();
    expect(h?.valueAddress).toBeUndefined();
    expect(h?.author).toBe("A");
  });

  it("a feed stating neither stores neither", () => {
    const h = harvestOf({ ...feed, funding: null, valueAddress: null }, 5);
    expect("funding" in h).toBe(false);
    expect("valueAddress" in h).toBe(false);
  });
});

describe("absorbPodcast — persistence that does not need a mounted tab", () => {
  const feed = (over: Partial<AbsorbablePodcast> = {}): AbsorbablePodcast => ({
    guid: "g-1",
    author: "Author",
    ownerEmail: null,
    website: null,
    categories: ["News"],
    language: "en",
    copyright: null,
    image: null,
    description: null,
    episodes: [{ publishedAt: 1_787_000_000 }],
    ...over,
  });

  beforeEach(() => {
    saveSubs([{ url: "u1", title: "One" }]);
  });

  it("folds guid, latestAt and harvest into the stored sub", () => {
    expect(absorbPodcast("u1", feed())).toBe(true);
    const [sub] = loadSubs();
    expect(sub.guid).toBe("g-1");
    expect(sub.latestAt).toBe(1_787_000_000);
    expect(sub.harvest?.author).toBe("Author");
    expect(sub.harvest?.categories).toEqual(["News"]);
  });

  it("reports no change when the feed says the same thing again", () => {
    absorbPodcast("u1", feed());
    const before = loadSubs()[0].harvest?.fetchedAt;
    expect(absorbPodcast("u1", feed())).toBe(false);
    expect(loadSubs()[0].harvest?.fetchedAt).toBe(before); // no churn, no rewrite
  });

  it("updates when the feed's account of itself changes", () => {
    absorbPodcast("u1", feed());
    expect(absorbPodcast("u1", feed({ author: "New Author" }))).toBe(true);
    expect(loadSubs()[0].harvest?.author).toBe("New Author");
  });

  it("ignores a feed that is not subscribed", () => {
    expect(absorbPodcast("not-subscribed", feed())).toBe(false);
    expect(loadSubs()).toHaveLength(1);
  });

  it("never touches the user's enrich slice", () => {
    saveSubs([{ url: "u1", title: "One", enrich: { website: "https://mine", editedAt: 3 } }]);
    absorbPodcast("u1", feed());
    expect(loadSubs()[0].enrich).toEqual({ website: "https://mine", editedAt: 3 });
  });

  it("notifies a mounted tab when there is a DOM, and works when there is not", () => {
    // No window here by default — absorbing must still persist (the tests above
    // all ran that way). With one present, the tab gets its nudge.
    const target = new EventTarget();
    let fired = 0;
    target.addEventListener(PODCASTS_EVENT, () => (fired += 1));
    (globalThis as { window?: EventTarget }).window = target;
    try {
      expect(absorbPodcast("u1", feed())).toBe(true);
    } finally {
      delete (globalThis as { window?: EventTarget }).window;
    }
    expect(fired).toBe(1);
  });
});

describe("setEnrich — the editor's store operation", () => {
  beforeEach(() => {
    saveSubs([{ url: "u1", title: "One", harvest: { author: "Feed", fetchedAt: 1 } }]);
  });

  it("stores what the user typed, trimmed", () => {
    expect(setEnrich("u1", { website: "  https://mine  ", author: "Me" })).toBe(true);
    expect(loadSubs()[0].enrich).toMatchObject({ website: "https://mine", author: "Me" });
  });

  it("never touches the harvest slice", () => {
    setEnrich("u1", { website: "https://mine" });
    expect(loadSubs()[0].harvest).toEqual({ author: "Feed", fetchedAt: 1 });
  });

  it("drops blanks rather than storing empty strings", () => {
    setEnrich("u1", { author: "Me", website: "   ", copyright: "" });
    const e = loadSubs()[0].enrich!;
    expect(e.author).toBe("Me");
    expect("website" in e).toBe(false);
    expect("copyright" in e).toBe(false);
  });

  it("splits and trims categories, dropping empty entries", () => {
    setEnrich("u1", { categories: ["News", "  ", " Tech "] });
    expect(loadSubs()[0].enrich?.categories).toEqual(["News", "Tech"]);
  });

  it("clearing every field removes the slice entirely", () => {
    setEnrich("u1", { author: "Me" });
    expect(loadSubs()[0].enrich).toBeDefined();
    expect(setEnrich("u1", {})).toBe(true);
    expect("enrich" in loadSubs()[0]).toBe(false);
  });

  it("saving without changing anything does not rewrite the store", () => {
    setEnrich("u1", { author: "Me" });
    const stamp = loadSubs()[0].enrich?.editedAt;
    expect(setEnrich("u1", { author: "Me" })).toBe(false);
    expect(loadSubs()[0].enrich?.editedAt).toBe(stamp);
  });

  it("a value the feed also states is stored anyway — dormant, not refused", () => {
    // The editor lets you write it; podcastIdentity decides what shows.
    setEnrich("u1", { author: "My own note" });
    const sub = loadSubs()[0];
    expect(sub.enrich?.author).toBe("My own note");
    expect(podcastIdentity(sub).author).toBe("Feed");
  });

  it("ignores a url that is not subscribed", () => {
    expect(setEnrich("nope", { author: "X" })).toBe(false);
  });
});
