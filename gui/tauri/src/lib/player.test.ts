import { describe, expect, it } from "vitest";
import { nextPosition, SKIP_BACK, SKIP_FORWARD } from "./player";

describe("nextPosition", () => {
  it("jogs forward and back by the delta", () => {
    expect(nextPosition(100, SKIP_FORWARD, 600)).toBe(130);
    expect(nextPosition(100, -SKIP_BACK, 600)).toBe(85);
  });

  it("floors at the start — skipping back from the first seconds rewinds to 0", () => {
    expect(nextPosition(4, -SKIP_BACK, 600)).toBe(0);
    expect(nextPosition(0, -SKIP_BACK, 600)).toBe(0);
  });

  it("clamps to the end rather than running past it", () => {
    expect(nextPosition(590, SKIP_FORWARD, 600)).toBe(600);
    expect(nextPosition(600, SKIP_FORWARD, 600)).toBe(600);
  });

  it("only floors when the duration isn't known yet", () => {
    // Metadata still loading: 0 and NaN both mean "no length to clamp against".
    expect(nextPosition(100, SKIP_FORWARD, 0)).toBe(130);
    expect(nextPosition(100, SKIP_FORWARD, NaN)).toBe(130);
    expect(nextPosition(5, -SKIP_BACK, 0)).toBe(0);
  });

  it("returns a position assignable to currentTime, never NaN or Infinity", () => {
    // A live source reports Infinity for both; nothing here may return a value
    // that would throw on assignment. skip() gates on `seekable` first — this is
    // the belt to that's braces.
    expect(nextPosition(Infinity, SKIP_FORWARD, Infinity)).toBe(0);
    expect(nextPosition(NaN, SKIP_FORWARD, 600)).toBe(0);
    expect(nextPosition(100, SKIP_FORWARD, Infinity)).toBe(130);
  });
});
