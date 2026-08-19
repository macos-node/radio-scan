import { describe, expect, it, vi } from "vitest";
import { describeOutcome, publishSequentially } from "./publishAll";

describe("publishSequentially", () => {
  it("publishes every item and reports the count", async () => {
    const seen: number[] = [];
    const out = await publishSequentially([1, 2, 3], async (n) => void seen.push(n), {
      delayMs: 0,
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(out).toEqual({ published: 3, failed: [] });
  });

  it("keeps going after a failure rather than stranding the rest", async () => {
    // One unreachable relay must not cost the remaining items.
    const out = await publishSequentially(
      ["a", "b", "c"],
      async (s) => {
        if (s === "b") throw new Error("relay refused");
      },
      { delayMs: 0 },
    );
    expect(out.published).toBe(2);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].item).toBe("b");
    expect(out.failed[0].error).toContain("relay refused");
  });

  it("runs strictly in sequence, never in parallel", async () => {
    // The point of the pacing: two publishes must not overlap.
    let inFlight = 0;
    let maxInFlight = 0;
    await publishSequentially([1, 2, 3, 4], async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    }, { delayMs: 0 });
    expect(maxInFlight).toBe(1);
  });

  it("pauses between items but not after the last one", async () => {
    vi.useFakeTimers();
    const run = publishSequentially([1, 2, 3], async () => {}, { delayMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(run).resolves.toEqual({ published: 3, failed: [] });
    vi.useRealTimers();
  });

  it("reports progress before each attempt and once at the end", async () => {
    const ticks: string[] = [];
    await publishSequentially([1, 2], async () => {}, {
      delayMs: 0,
      onProgress: (done, total) => ticks.push(`${done}/${total}`),
    });
    expect(ticks).toEqual(["0/2", "1/2", "2/2"]);
  });

  it("an empty list is a no-op, not an error", async () => {
    const out = await publishSequentially([], async () => {}, { delayMs: 0 });
    expect(out).toEqual({ published: 0, failed: [] });
  });
});

describe("describeOutcome", () => {
  it("words each shape the same way for both tabs", () => {
    expect(describeOutcome({ published: 3, failed: [] })).toBe("published 3");
    expect(describeOutcome({ published: 0, failed: [{ item: 1, error: "x" }] })).toBe(
      "none published — 1 failed",
    );
    expect(
      describeOutcome({ published: 2, failed: [{ item: 1, error: "x" }] }),
    ).toBe("published 2, 1 failed");
  });
});
