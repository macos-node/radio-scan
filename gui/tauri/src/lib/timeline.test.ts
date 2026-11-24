import { describe, expect, it } from "vitest";
import type { Episode, Podcast } from "./tauri";
import {
  EMPTY_LEDGER,
  FOLD_MIN,
  buildTimeline,
  epHash,
  fillerCount,
  groupByDay,
  isNew,
  parseLedger,
  updateLedger,
  type FeedIn,
} from "./timeline";

const DAY = 86_400;
// Noon local time, so "today" and "yesterday" don't straddle midnight.
const NOW = Math.floor(new Date(2026, 10, 9, 12, 0, 0).getTime() / 1000);

function ep(id: string, at: number | null): Episode {
  return { id, title: id, enclosureUrl: `https://x/${id}.mp3`, mime: null, durationSecs: 60, publishedAt: at };
}
function pod(title: string, episodes: Episode[]): Podcast {
  return {
    title, description: null, image: null, author: null, ownerEmail: null, website: null,
    categories: [], language: null, copyright: null, guid: null, funding: null,
    valueAddress: null, episodes,
  };
}
function feed(url: string, episodes: Episode[], title = ""): FeedIn {
  return { url, title, pod: pod(`feed ${url}`, episodes) };
}

describe("buildTimeline", () => {
  it("merges feeds newest first and keeps only the range", () => {
    const t = buildTimeline(
      [
        feed("a", [ep("a1", NOW - 3600), ep("a2", NOW - 8 * DAY)]),
        feed("b", [ep("b1", NOW - 60), ep("b2", NOW - 2 * DAY)]),
      ],
      NOW,
      7,
    );
    expect(t.map((e) => e.ep.id)).toEqual(["b1", "a1", "b2"]);
  });

  it("counts episodes, so a wider range shows more of the same show", () => {
    const f = [feed("a", [ep("a1", NOW - DAY / 2), ep("a2", NOW - 5 * DAY), ep("a3", NOW - 10 * DAY)])];
    expect(buildTimeline(f, NOW, 1)).toHaveLength(1);
    expect(buildTimeline(f, NOW, 7)).toHaveLength(2);
    expect(buildTimeline(f, NOW, 14)).toHaveLength(3);
  });

  it("drops undated and far-future episodes, and skips unloaded feeds", () => {
    const t = buildTimeline(
      [
        feed("a", [ep("undated", null), ep("future", NOW + 5 * DAY), ep("ok", NOW - 1)]),
        { url: "b", title: "B", pod: undefined },
      ],
      NOW,
      7,
    );
    expect(t.map((e) => e.ep.id)).toEqual(["ok"]);
  });

  it("names the show by the subscription title, else the feed's", () => {
    const [x, y] = buildTimeline(
      [feed("a", [ep("a1", NOW - 1)], "My name"), feed("b", [ep("b1", NOW - 2)])],
      NOW,
      7,
    );
    expect(x.show).toBe("My name");
    expect(y.show).toBe("feed b");
  });
});

describe("groupByDay", () => {
  it("labels today and yesterday", () => {
    const g = groupByDay(
      buildTimeline([feed("a", [ep("a1", NOW - 60), ep("a2", NOW - DAY), ep("a3", NOW - 3 * DAY)])], NOW, 7),
      NOW,
    );
    expect(g.map((d) => d.label).slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(g).toHaveLength(3);
  });

  it(`folds a show with ${FOLD_MIN}+ episodes on one day into one row`, () => {
    const burst = Array.from({ length: FOLD_MIN }, (_, i) => ep(`p${i}`, NOW - 7200));
    const g = groupByDay(
      buildTimeline([feed("p", burst), feed("a", [ep("a1", NOW - 60), ep("a2", NOW - 9000)])], NOW, 7),
      NOW,
    );
    expect(g).toHaveLength(1);
    const kinds = g[0].rows.map((r) => (r.kind === "fold" ? `fold:${r.entries.length}` : r.entry.ep.id));
    expect(kinds).toEqual(["a1", `fold:${FOLD_MIN}`, "a2"]);
  });

  it("leaves a show under the threshold unfolded", () => {
    const few = Array.from({ length: FOLD_MIN - 1 }, (_, i) => ep(`p${i}`, NOW - 60 - i));
    const g = groupByDay(buildTimeline([feed("p", few)], NOW, 7), NOW);
    expect(g[0].rows.every((r) => r.kind === "one")).toBe(true);
  });
});

describe("ledger", () => {
  it("baselines a feed it hasn't seen, so nothing lights up on first run", () => {
    const l = updateLedger(EMPTY_LEDGER, [feed("a", [ep("a1", NOW - 60)])], NOW);
    expect(Object.keys(l)).toEqual(["a"]);
    expect(isNew(l, "a", "a1", NOW - 3600)).toBe(false);
  });

  it("marks an episode picked up on a later scan as new — even a back-dated one", () => {
    const l0 = updateLedger(EMPTY_LEDGER, [feed("a", [ep("a1", NOW - 2 * DAY)])], NOW - DAY);
    const l1 = updateLedger(
      l0,
      [feed("a", [ep("late", NOW - 3 * DAY), ep("a1", NOW - 2 * DAY)])],
      NOW,
    );
    expect(isNew(l1, "a", "late", NOW - 3600)).toBe(true);
    expect(isNew(l1, "a", "a1", NOW - 3600)).toBe(false);
    // Looked again after it was picked up: no longer new.
    expect(isNew(l1, "a", "late", NOW + 1)).toBe(false);
  });

  it("returns the same object when nothing changed", () => {
    const f = [feed("a", [ep("a1", NOW - 60)])];
    const l = updateLedger(EMPTY_LEDGER, f, NOW);
    expect(updateLedger(l, f, NOW + 10)).toBe(l);
  });

  it("leaves feeds that aren't loaded yet alone", () => {
    const l = updateLedger(EMPTY_LEDGER, [feed("a", [ep("a1", NOW - 60)])], NOW);
    expect(updateLedger(l, [{ url: "a", title: "A", pod: undefined }], NOW + 10)).toBe(l);
  });

  it("never wipes the record on an empty subscription list", () => {
    const l = updateLedger(EMPTY_LEDGER, [feed("a", [ep("a1", NOW - 60)])], NOW);
    expect(updateLedger(l, [], NOW + 10)).toBe(l);
  });

  it("forgets an unsubscribed feed, and episodes that age out", () => {
    const l = updateLedger(
      EMPTY_LEDGER,
      [feed("a", [ep("a1", NOW - 60)]), feed("b", [ep("b1", NOW - 60)])],
      NOW,
    );
    const l2 = updateLedger(l, [feed("a", [ep("a1", NOW - 60)])], NOW + 20 * DAY);
    expect(l2).toEqual({ a: {} });
  });

  it("does not re-flag an aged-out episode", () => {
    const l = updateLedger(EMPTY_LEDGER, [feed("a", [])], NOW);
    expect(updateLedger(l, [feed("a", [ep("old", NOW - 40 * DAY)])], NOW)).toBe(l);
  });

  it("keeps a feed's baseline mark even with no recent episodes", () => {
    const l = updateLedger(EMPTY_LEDGER, [feed("a", [])], NOW);
    const l2 = updateLedger(l, [feed("a", [ep("new", NOW)])], NOW + 60);
    expect(isNew(l2, "a", "new", NOW)).toBe(true);
  });

  it("parses junk as empty", () => {
    expect(parseLedger(null)).toEqual(EMPTY_LEDGER);
    expect(parseLedger("{")).toEqual(EMPTY_LEDGER);
    expect(parseLedger("[1]")).toEqual(EMPTY_LEDGER);
    expect(parseLedger('{"a":{"x":5,"bad":"y"},"b":3}')).toEqual({ a: { x: 5 } });
  });

  it("hashes ids short and stable", () => {
    expect(epHash("https://example.com/a-very-long-episode-guid.mp3")).toMatch(/^[0-9a-z]{1,7}$/);
    expect(epHash("x")).toBe(epHash("x"));
    expect(epHash("x")).not.toBe(epHash("y"));
  });
});

describe("fillerCount", () => {
  it("completes a short last row", () => {
    expect(fillerCount(10, 6)).toBe(2);
    expect(fillerCount(1, 8)).toBe(7);
  });

  it("adds nothing to a full row", () => {
    expect(fillerCount(12, 6)).toBe(0);
    expect(fillerCount(8, 8)).toBe(0);
  });

  it("adds nothing with no items or no measured columns", () => {
    expect(fillerCount(0, 6)).toBe(0);
    expect(fillerCount(5, 0)).toBe(0);
  });
});
