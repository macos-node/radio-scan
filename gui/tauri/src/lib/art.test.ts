import { describe, it, expect } from "vitest";
import { makeArtCache } from "./art";

describe("makeArtCache", () => {
  it("asks once per URL, however many tiles want it", async () => {
    const calls: string[] = [];
    const cache = makeArtCache(async (u) => {
      calls.push(u);
      return `data:${u}`;
    });
    const [a, b] = await Promise.all([cache.load("x"), cache.load("x")]);
    expect(a).toBe("data:x");
    expect(b).toBe("data:x");
    expect(calls).toEqual(["x"]);
  });

  it("turns any failure into null (keep the glyph)", async () => {
    const cache = makeArtCache(async () => {
      throw new Error("decode");
    });
    expect(await cache.load("bad")).toBeNull();
    expect(cache.peek("bad")).toBeNull();
  });

  it("peek is undefined until a load resolves", async () => {
    const cache = makeArtCache(async (u) => u);
    expect(cache.peek("y")).toBeUndefined();
    await cache.load("y");
    expect(cache.peek("y")).toBe("y");
  });

  it("keeps at most `limit` fetches in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const cache = makeArtCache(async (u) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return u;
    }, 2);
    await Promise.all(["a", "b", "c", "d", "e"].map((u) => cache.load(u)));
    expect(peak).toBe(2);
  });
});
