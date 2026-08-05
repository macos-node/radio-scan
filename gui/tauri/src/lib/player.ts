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
