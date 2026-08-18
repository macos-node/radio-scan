import { describe, expect, it } from "vitest";
import { latestEpisodeAt, mergeSubs, sortSubs, type Sub } from "./podcasts";

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
