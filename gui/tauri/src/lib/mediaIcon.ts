// Media-icon matching — maps a podcast (and later a station) title to a simple,
// generic, monochrome square glyph for the card view. Pure logic (no React) so
// it's unit-tested in a node env; the key → icon component mapping lives in
// components/MediaGlyph.tsx.
//
// Rules are keyword / format heuristics, FIRST MATCH WINS. Specific subjects
// (bitcoin, privacy, news, tree, duck) are ordered before the generic person-host
// format so "The Bitcoin Podcast" reads as bitcoin, not a person. Extend
// PODCAST_RULES as new animal/object matches land.
//
// Not yet mapped (open): a goat glyph (no lucide icon — needs custom SVG) and how
// to represent "gold" — left out deliberately until decided. Stations will get a
// sibling matcher (FM + simple genres) reusing the same key → glyph plumbing.

export type MediaIconKey =
  // podcasts
  | "bitcoin"
  | "privacy"
  | "news"
  | "tree"
  | "duck"
  | "host"
  | "default"
  // stations (genres; `fm` is the generic default)
  | "fm"
  | "ambient"
  | "jazz"
  | "rock"
  | "electronic"
  | "classical";

interface Rule {
  key: MediaIconKey;
  test: RegExp;
}

// Order = priority. Subject keywords first; the "The <name> Podcast/Show"
// person-host format is the last-resort pattern before the generic default.
const PODCAST_RULES: Rule[] = [
  // "anything mentioning Bitcoin" → substring; plus the BTC ticker as a word.
  { key: "bitcoin", test: /bitcoin|\bbtc\b/i },
  { key: "privacy", test: /\bprivacy\b/i },
  { key: "news", test: /\bnews\b/i },
  { key: "tree", test: /\btrees?\b/i },
  { key: "duck", test: /\bducks?\b/i },
  // Person-as-host: "The Peter McCormack Podcast", "The Tim Ferriss Show".
  { key: "host", test: /^the\s+.+\s+(podcast|show)\b/i },
];

/** The glyph key for a podcast title. First matching rule wins; "default" when
 *  nothing matches (a generic podcast glyph). */
export function podcastIconKey(title: string): MediaIconKey {
  const t = (title ?? "").trim();
  for (const rule of PODCAST_RULES) {
    if (rule.test.test(t)) return rule.key;
  }
  return "default";
}

// --- stations: FM + simple genres -------------------------------------------
// Stations match on name + tags (genres). Substring (not word-boundary) so messy
// names like "JAZZ24" or "Technobase.fm" still land. Keep the genre set small and
// generic; the default is "fm" (a plain radio glyph). Extend as needed.

const STATION_RULES: { key: MediaIconKey; needles: string[] }[] = [
  { key: "news", needles: ["news"] },
  { key: "jazz", needles: ["jazz"] },
  { key: "ambient", needles: ["ambient", "drone"] },
  { key: "classical", needles: ["classical"] },
  { key: "rock", needles: ["rock", "metal"] },
  { key: "electronic", needles: ["electro", "techno", "house", "trance", "edm"] },
];

/** The glyph key for a station, from its name + genre tags. First matching rule
 *  wins; "fm" (generic radio) when no genre is recognised. */
export function stationIconKey(name: string, tags: string[] = []): MediaIconKey {
  const hay = [name ?? "", ...tags].join(" ").toLowerCase();
  for (const rule of STATION_RULES) {
    if (rule.needles.some((n) => hay.includes(n))) return rule.key;
  }
  return "fm";
}
