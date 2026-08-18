import { describe, expect, it } from "vitest";
import { latestEpisodeAt, sortSubs, type Sub } from "./podcasts";

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
