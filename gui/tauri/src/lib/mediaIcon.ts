// Media-icon matching — maps a podcast (and later a station) title to a simple,
// generic, monochrome square glyph for the card view. Pure logic (no React) so
// it's unit-tested in a node env; the key → icon component mapping lives in
// components/MediaGlyph.tsx.
//
// Rules are keyword / format heuristics, FIRST MATCH WINS. Specific subjects
// (bitcoin, privacy, news, sport, tree, duck) are ordered before the generic
// person-host format so "The Bitcoin Podcast" reads as bitcoin, not a person.
// Extend PODCAST_RULES as new animal/object matches land.
//
// When the title says nothing, the feed's own categories (Apple's top-level
// itunes:category set — "Technology", "Sports", "Health & Fitness", …) pick the
// glyph, in the order the feed lists them. Only "default" is left for a feed with
// neither a telling title nor a known category.
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
  // podcasts — from the feed's categories (Apple's top-level set)
  | "sport"
  | "technology"
  | "business"
  | "comedy"
  | "education"
  | "health"
  | "music"
  | "society"
  | "arts"
  | "science"
  | "history"
  | "government"
  | "fiction"
  | "film"
  | "crime"
  | "kids"
  | "leisure"
  | "religion"
  // stations (genres; `fm` is the generic default)
  | "fm"
  | "ambient"
  | "jazz"
  | "rock"
  | "electronic"
  | "classical"
  | "hiphop"
  | "space"
  | "lounge"
  | "folk";

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
  // Sport by subject, so "The Cycling Podcast" doesn't fall to the host format.
  {
    key: "sport",
    test: /\b(sports?|cycling|football|soccer|cricket|rugby|tennis|golf|formula\s?1|f1|nfl|nba)\b/i,
  },
  { key: "tree", test: /\btrees?\b/i },
  { key: "duck", test: /\bducks?\b/i },
  // Person-as-host: "The Peter McCormack Podcast", "The Tim Ferriss Show".
  { key: "host", test: /^the\s+.+\s+(podcast|show)\b/i },
];

// Feed category → glyph. Matched as substrings of the lower-cased category, so
// "News & Politics" / "News Commentary" (older and sub-category spellings) land
// too. Order matters only where needles could overlap ("history" vs "story").
const CATEGORY_RULES: { key: MediaIconKey; needles: string[] }[] = [
  { key: "news", needles: ["news", "politics"] },
  { key: "sport", needles: ["sport"] },
  { key: "technology", needles: ["technology", "tech"] },
  { key: "business", needles: ["business", "investing", "entrepreneur"] },
  { key: "comedy", needles: ["comedy"] },
  { key: "education", needles: ["education", "courses", "language learning"] },
  { key: "health", needles: ["health", "fitness", "medicine", "nutrition"] },
  { key: "music", needles: ["music"] },
  { key: "society", needles: ["society", "culture", "documentary"] },
  { key: "arts", needles: ["arts", "design", "books"] },
  { key: "science", needles: ["science"] },
  { key: "history", needles: ["history"] },
  { key: "government", needles: ["government"] },
  { key: "fiction", needles: ["fiction", "drama"] },
  { key: "film", needles: ["tv & film", "film", "tv"] },
  { key: "crime", needles: ["true crime", "crime"] },
  { key: "kids", needles: ["kids", "family"] },
  { key: "leisure", needles: ["leisure", "games", "hobbies"] },
  { key: "religion", needles: ["religion", "spirituality"] },
];

/** The glyph key for a feed's categories, tried in the feed's own order (its
 *  first category is its primary one). undefined when none is recognised. */
export function categoryIconKey(categories: string[] = []): MediaIconKey | undefined {
  for (const raw of categories) {
    const c = (raw ?? "").toLowerCase();
    if (!c) continue;
    for (const rule of CATEGORY_RULES) {
      if (rule.needles.some((n) => c.includes(n))) return rule.key;
    }
  }
  return undefined;
}

/** The glyph key for a podcast: its title's subject first, then the person-host
 *  format, then the feed's categories; "default" (a generic podcast glyph) when
 *  none of them says anything. */
export function podcastIconKey(title: string, categories: string[] = []): MediaIconKey {
  const t = (title ?? "").trim();
  for (const rule of PODCAST_RULES) {
    if (rule.test.test(t)) return rule.key;
  }
  return categoryIconKey(categories) ?? "default";
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
  { key: "hiphop", needles: ["hiphop", "hip-hop", "hip hop"] },
  { key: "space", needles: ["space"] },
  { key: "lounge", needles: ["lounge", "downtempo", "chill"] },
  { key: "folk", needles: ["americana", "country", "folk", "bluegrass"] },
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
