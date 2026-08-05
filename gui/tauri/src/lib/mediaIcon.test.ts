import { describe, it, expect } from "vitest";
import { podcastIconKey, stationIconKey } from "./mediaIcon";

// The matcher is a keyword/format heuristic — first rule wins. Specific subjects
// beat the generic person-host format, so "The Bitcoin Podcast" reads as bitcoin.
describe("podcastIconKey", () => {
  it("matches Bitcoin mentioned anywhere (case-insensitive) + BTC", () => {
    expect(podcastIconKey("What Bitcoin Did")).toBe("bitcoin");
    expect(podcastIconKey("bitcoin optech")).toBe("bitcoin");
    expect(podcastIconKey("The BTC Show")).toBe("bitcoin");
  });

  it("lets Bitcoin win over the host format", () => {
    expect(podcastIconKey("The Bitcoin Podcast")).toBe("bitcoin");
  });

  it("matches privacy → lock", () => {
    expect(podcastIconKey("Opt Out: a privacy podcast")).toBe("privacy");
    expect(podcastIconKey("Privacy International")).toBe("privacy");
  });

  it("matches news → newspaper", () => {
    expect(podcastIconKey("The News Agents")).toBe("news");
    expect(podcastIconKey("BBC News")).toBe("news");
  });

  it("matches the 'The <name> Podcast/Show' person-host format", () => {
    expect(podcastIconKey("The Peter McCormack Podcast")).toBe("host");
    expect(podcastIconKey("The Tim Ferriss Show")).toBe("host");
  });

  it("does not treat a bare 'The X' (no Podcast/Show) as a host", () => {
    expect(podcastIconKey("The Daily")).toBe("default");
  });

  it("matches the extensible tree / duck keyword rules", () => {
    expect(podcastIconKey("The Tree Podcast")).toBe("tree");
    expect(podcastIconKey("Duck Tales Rewatched")).toBe("duck");
  });

  it("falls back to default when nothing matches (incl. empty)", () => {
    expect(podcastIconKey("Radiolab")).toBe("default");
    expect(podcastIconKey("")).toBe("default");
  });
});

// Stations match on name + tags (genres) — substring, so messy names like
// "JAZZ24" or "Technobase.fm" still land. Default is the generic "fm" (radio).
describe("stationIconKey", () => {
  it("matches simple genres from tags", () => {
    expect(stationIconKey("Acid Jazz", ["acid", "jazz"])).toBe("jazz");
    expect(stationIconKey("SomaFM — Groove Salad", ["ambient", "downtempo"])).toBe("ambient");
    expect(stationIconKey("SomaFM — Drone Zone", ["ambient", "space"])).toBe("ambient");
    expect(stationIconKey("Classical KUSC", ["classical"])).toBe("classical");
    expect(stationIconKey("Rock Antenne", ["classic rock"])).toBe("rock");
    expect(stationIconKey("Technobase", ["techno"])).toBe("electronic");
    expect(stationIconKey("BBC Radio 4", ["news", "talk"])).toBe("news");
  });

  it("matches from the name too, case-insensitive (no tags)", () => {
    expect(stationIconKey("JAZZ24", [])).toBe("jazz");
    expect(stationIconKey("Ambient Sleeping Pill", [])).toBe("ambient");
  });

  it("defaults to fm when no genre is recognised", () => {
    expect(stationIconKey("SomaFM — Secret Agent", ["downtempo", "lounge"])).toBe("fm");
    expect(stationIconKey("Groove FM", [])).toBe("fm");
    expect(stationIconKey("", [])).toBe("fm");
  });
});
