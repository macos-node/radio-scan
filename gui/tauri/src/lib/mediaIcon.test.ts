import { describe, it, expect } from "vitest";
import { categoryIconKey, podcastIconKey, stationIconKey } from "./mediaIcon";

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

  it("reads sport from the title, ahead of the host format", () => {
    expect(podcastIconKey("The Cycling Podcast", ["Sports", "News"])).toBe("sport");
    expect(podcastIconKey("The Cycling Podcast")).toBe("sport");
    expect(podcastIconKey("Football Weekly")).toBe("sport");
  });

  it("falls back to the feed's categories when the title says nothing", () => {
    expect(podcastIconKey("Accidental Tech Podcast", ["Technology"])).toBe("technology");
    expect(podcastIconKey("Doc Malik", ["Health & Fitness"])).toBe("health");
    expect(podcastIconKey("The Joe Rogan Experience", ["Comedy"])).toBe("comedy");
    expect(podcastIconKey("The Bugle Weekly", ["News", "Society & Culture"])).toBe("news");
    expect(podcastIconKey("Field Recordings", ["Society & Culture"])).toBe("society");
    expect(podcastIconKey("PIRANHA SIBERIA DUB", ["Music"])).toBe("music");
  });

  it("keeps title subjects and the host format ahead of categories", () => {
    expect(podcastIconKey("The Bitcoin Layer", ["Business", "Technology"])).toBe("bitcoin");
    expect(podcastIconKey("The Peter McCormack Show", ["News"])).toBe("host");
    expect(podcastIconKey("A Duck in a Tree", ["Music"])).toBe("tree");
  });

  it("falls back to default when nothing matches (incl. empty)", () => {
    expect(podcastIconKey("Radiolab")).toBe("default");
    expect(podcastIconKey("")).toBe("default");
  });
});

describe("categoryIconKey", () => {
  it("tries categories in the feed's order", () => {
    expect(categoryIconKey(["Business", "Technology"])).toBe("business");
    expect(categoryIconKey(["Unknown", "Technology"])).toBe("technology");
  });

  it("matches older and sub-category spellings", () => {
    expect(categoryIconKey(["News & Politics"])).toBe("news");
    expect(categoryIconKey(["News Commentary"])).toBe("news");
    expect(categoryIconKey(["TV & Film"])).toBe("film");
    expect(categoryIconKey(["True Crime"])).toBe("crime");
    expect(categoryIconKey(["Religion & Spirituality"])).toBe("religion");
  });

  it("is undefined when nothing is recognised", () => {
    expect(categoryIconKey([])).toBeUndefined();
    expect(categoryIconKey(["", "Misc"])).toBeUndefined();
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

  it("matches the added genres (hiphop, space, lounge, folk)", () => {
    expect(stationIconKey("Fluid", ["hiphop", "future-soul"])).toBe("hiphop");
    expect(stationIconKey("Space Station Soma", ["space", "electronica"])).toBe("space");
    expect(stationIconKey("Secret Agent", ["downtempo", "lounge", "spy"])).toBe("lounge");
    expect(stationIconKey("Boot Liquor", ["americana", "roots"])).toBe("folk");
  });

  it("matches from the name too, case-insensitive (no tags)", () => {
    expect(stationIconKey("JAZZ24", [])).toBe("jazz");
    expect(stationIconKey("Ambient Sleeping Pill", [])).toBe("ambient");
  });

  it("defaults to fm when no genre is recognised", () => {
    expect(stationIconKey("SomaFM — Secret Agent", ["spy"])).toBe("fm");
    expect(stationIconKey("Groove FM", [])).toBe("fm");
    expect(stationIconKey("", [])).toBe("fm");
  });
});
