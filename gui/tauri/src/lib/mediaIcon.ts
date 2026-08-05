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
  | "bitcoin"
  | "privacy"
  | "news"
  | "tree"
  | "duck"
  | "host"
  | "default";

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
