import {
  Bird,
  Bitcoin,
  Disc3,
  Guitar,
  Lock,
  Music,
  Newspaper,
  Piano,
  Podcast,
  Radio,
  Trees,
  UserRound,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { MediaIconKey } from "../lib/mediaIcon";

// Key → glyph. Simple, generic, monochrome line icons (lucide) — one per matched
// category. Keep these plain and interchangeable; the point is a recognisable
// silhouette next to a title, not decoration. `default` is the generic podcast
// glyph, `fm` the generic station glyph. (goat/gold are unmapped for now — see
// lib/mediaIcon.)
const ICONS: Record<MediaIconKey, LucideIcon> = {
  // podcasts
  bitcoin: Bitcoin,
  privacy: Lock,
  news: Newspaper,
  tree: Trees,
  duck: Bird,
  host: UserRound,
  default: Podcast,
  // stations (genres; fm = generic)
  fm: Radio,
  ambient: Waves,
  jazz: Music,
  rock: Guitar,
  electronic: Disc3,
  classical: Piano,
};

/** A simple monochrome square glyph for a media card. Square by construction;
 *  colour follows the theme via `currentColor`, so it stays monochrome in every
 *  theme. Reused by stations later (same plumbing, a different matcher). */
export function MediaGlyph({
  iconKey,
  size = 40,
}: {
  iconKey: MediaIconKey;
  size?: number;
}) {
  const Icon = ICONS[iconKey];
  return (
    <span
      className="grid aspect-square shrink-0 place-items-center rounded-sm border border-surface bg-surface text-muted"
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  );
}
