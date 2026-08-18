import { describe, expect, it } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import { parseStation, resolveStations } from "./station";

const PK = "916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d";

const ev = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent =>
  ({
    id: "aa".repeat(32),
    pubkey: PK,
    created_at: 1_755_000_000,
    kind: 31241,
    content: "",
    sig: "",
    ...over,
  }) as NostrEvent;

describe("parseStation", () => {
  it("carries the event id so an unfollow can name it in an `e` tag", () => {
    const s = parseStation(
      ev({
        id: "b6835db6fa53" + "0".repeat(52),
        tags: [
          ["d", "airplay:station:acid-jazz"],
          ["name", "Acid Jazz"],
          ["r", "http://79.111.14.76:8000/acidjazz"],
        ],
      }),
    );
    expect(s?.slug).toBe("acid-jazz");
    expect(s?.eventId).toBe("b6835db6fa53" + "0".repeat(52));
  });

  it("still rejects a record missing d / name / r", () => {
    expect(parseStation(ev({ tags: [["d", "airplay:station:x"]] }))).toBeNull();
  });
});

describe("resolveStations", () => {
  const station = (d: string, at: number, id = "aa".repeat(32)) =>
    ev({
      id,
      created_at: at,
      tags: [
        ["d", `airplay:station:${d}`],
        ["name", d],
        ["r", `http://example.com/${d}`],
      ],
    });
  const del = (d: string, at: number): NostrEvent =>
    ev({
      id: "cc".repeat(32),
      kind: 5,
      created_at: at,
      tags: [["a", `31241:${PK}:airplay:station:${d}`]],
    });

  it("drops a deleted station but keeps a later re-publish", () => {
    const resolved = resolveStations(
      [station("gone", 100), del("gone", 200), station("back", 300), del("back", 200)],
      PK,
    );
    expect(resolved.map((s) => s.slug)).toEqual(["back"]);
  });

  it("resolved stations expose the event id of the winning event", () => {
    const resolved = resolveStations([station("keep", 100, "dd".repeat(32))], PK);
    expect(resolved[0].eventId).toBe("dd".repeat(32));
  });
});
