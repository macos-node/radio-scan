import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveStations, STATION_KIND, OWNER_PUBKEY } from "./station";
import { resolveShows, SHOW_KIND } from "./show";
import { supersededAddresses, ingestEvent } from "./addressable";

const evs = readFileSync("/tmp/live_stream.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("the real relay stream through the real resolver", () => {
  it("resolves what the app should be showing", () => {
    const t0 = Date.now();
    const st = resolveStations(evs, OWNER_PUBKEY);
    const sh = resolveShows(evs, OWNER_PUBKEY);
    const sup = new Map([
      ...supersededAddresses(evs, STATION_KIND, OWNER_PUBKEY),
      ...supersededAddresses(evs, SHOW_KIND, OWNER_PUBKEY),
    ]);
    console.log(`events=${evs.length} stations=${st.length} shows=${sh.length} superseded=${sup.size} in ${Date.now()-t0}ms`);
    expect(st.length).toBe(9);
    expect(sh.length).toBe(10);
  });

  it("survives the incremental path the app actually uses", () => {
    const map = new Map();
    const t0 = Date.now();
    let recomputes = 0;
    for (const ev of evs) {
      if (ingestEvent(map, ev, [STATION_KIND, SHOW_KIND])) {
        recomputes++;
        const all = [...map.values()];
        resolveStations(all, OWNER_PUBKEY);
        resolveShows(all, OWNER_PUBKEY);
        supersededAddresses(all, STATION_KIND, OWNER_PUBKEY);
        supersededAddresses(all, SHOW_KIND, OWNER_PUBKEY);
      }
    }
    console.log(`incremental: ${recomputes} recomputes over ${evs.length} events in ${Date.now()-t0}ms`);
  });
});
