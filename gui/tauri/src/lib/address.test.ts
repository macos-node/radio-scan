import { describe, expect, it } from "vitest";
// Imported, not read from disk: the vectors are contract, so the test fails to
// COMPILE if the file moves — and no node type shims are needed for it.
import vectors from "../../../../schema/station-address.vectors.json";
import { canonicalUrl, sameTarget } from "./address";

/** The same pinned contract the Rust publisher is held to. A renderer that
 *  canonicalises differently would decide two devices' rows are different things,
 *  which is the bug this whole decision exists to end. */
describe("canonicalUrl — against the pinned vectors", () => {
  const doc = vectors as { vectors: { url: string; canonical: string }[] };

  it("has vectors to check", () => {
    expect(doc.vectors.length).toBeGreaterThan(0);
  });

  for (const v of doc.vectors) {
    it(`${v.url} -> ${v.canonical}`, () => {
      expect(canonicalUrl(v.url)).toBe(v.canonical);
    });
  }
});

describe("sameTarget", () => {
  it("sees through the scheme — the real store's duplicate", () => {
    // These two rows sat in stations.json as separate stations and published as
    // ONE event, which is what left one of them permanently "unpublished".
    expect(
      sameTarget(
        "https://ice1.somafm.com/dronezone-128-mp3",
        "http://ice1.somafm.com/dronezone-128-mp3",
      ),
    ).toBe(true);
  });

  it("does not merge genuinely different mounts", () => {
    expect(sameTarget("http://x.example/a", "http://x.example/b")).toBe(false);
    expect(sameTarget("http://x.example/A", "http://x.example/a")).toBe(false);
    expect(sameTarget("http://x.example:8000/a", "http://x.example/a")).toBe(false);
  });
});
