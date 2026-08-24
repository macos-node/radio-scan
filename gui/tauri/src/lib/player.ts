// The unified "what's playing" model (U4). Radio and podcasts share one <audio>
// element and one player bar, but differ: a station is a live, non-seekable
// stream; an episode is a finite, seekable, resumable file.

export interface Playing {
  kind: "station" | "episode";
  /** station slug | episode id — used to highlight the row that's playing. */
  key: string;
  title: string;
  /** Podcast name, for episodes. */
  subtitle?: string;
  /** Stream / enclosure URL the <audio> element loads. */
  url: string;
  /** Episodes are seekable + resumable; live stations are not. */
  seekable: boolean;
}

// --- skip step (episodes) ----------------------------------------------------
// Asymmetric on purpose, and the podcast convention: back is for catching a line
// you missed, forward is for stepping over an ad break.

/** Seconds the back-skip jogs the playhead. */
export const SKIP_BACK = 15;
/** Seconds the forward-skip jogs the playhead. */
export const SKIP_FORWARD = 30;

/** Where a `delta`-second jog from `position` lands, clamped to the episode.
 *  A `duration` of 0 means "not known yet" (metadata still loading), in which
 *  case only the floor at 0 applies — the end can't be clamped against a length
 *  we don't have. Forward-skipping to exactly the end is allowed: the element
 *  fires `ended` there, which is what a skip past the last seconds should do. */
export function nextPosition(
  position: number,
  delta: number,
  duration: number,
): number {
  // A non-finite playhead (no source loaded, or a live stream's Infinity) isn't a
  // position to jog from — return the start, the one value that's always safe to
  // assign to `currentTime`. skip() gates on `seekable` before ever getting here.
  if (!Number.isFinite(position)) return 0;
  const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.max(0, Math.min(position + delta, end));
}

// --- resume positions (episodes) --------------------------------------------
// Keyed by enclosure URL so a podcast resumes where you left off across sessions.

const POS_KEY = "ntune.positions";

function loadPositions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Resume point (seconds) for an episode URL, or 0. */
export function resumePosition(url: string): number {
  const v = loadPositions()[url];
  return Number.isFinite(v) ? v : 0;
}

/** Persist an episode's position; positions under 5s (or past the end) are
 *  dropped so a barely-started or finished episode doesn't "resume". */
export function savePosition(url: string, secs: number, duration?: number): void {
  const m = loadPositions();
  const nearEnd = duration ? secs > duration - 15 : false;
  if (secs > 5 && !nearEnd) m[url] = Math.floor(secs);
  else delete m[url];
  localStorage.setItem(POS_KEY, JSON.stringify(m));
}
