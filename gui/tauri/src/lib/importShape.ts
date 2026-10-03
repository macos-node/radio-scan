// Telling a stations file from a podcasts file by its shape.
//
// Both exports are a bare JSON array of objects with a `url`, so nothing but the
// other fields says which is which — and each tab's importer used to take
// whatever it was given. A stations export imported from the Podcasts tab was
// accepted without a word: eleven stream addresses became eleven "podcasts",
// titled by their own URL (macOS, 2026-10-03). The parsers now ask first.
//
// A station carries `name` and usually `slug`; a podcast carries `title`. An
// entry with only a `url` could be either and is left alone, so the minimal
// hand-written lists both importers have always accepted still work.

const isRecord = (r: unknown): r is Record<string, unknown> =>
  !!r && typeof r === "object" && !Array.isArray(r);

const stationish = (r: unknown): boolean =>
  isRecord(r) && ("name" in r || "slug" in r) && !("title" in r);

const podcastish = (r: unknown): boolean =>
  isRecord(r) && "title" in r && !("name" in r) && !("slug" in r);

/** A list in which entries look like stations and none looks like a podcast. */
export function looksLikeStations(data: unknown): boolean {
  return Array.isArray(data) && data.some(stationish) && !data.some(podcastish);
}

/** A list in which entries look like podcasts and none looks like a station. */
export function looksLikePodcasts(data: unknown): boolean {
  return Array.isArray(data) && data.some(podcastish) && !data.some(stationish);
}
