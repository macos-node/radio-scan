import {
  Baby,
  Bird,
  Bitcoin,
  BookOpen,
  Briefcase,
  Clapperboard,
  Coffee,
  Cpu,
  Disc3,
  FlaskConical,
  Gamepad2,
  Globe,
  GraduationCap,
  Guitar,
  HeartPulse,
  Hourglass,
  Landmark,
  Laugh,
  Lock,
  MicVocal,
  Music,
  Newspaper,
  Palette,
  Piano,
  Podcast,
  Radio,
  Rocket,
  Search,
  Sparkles,
  Trees,
  Trophy,
  UserRound,
  Waves,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import type { MediaIconKey } from "../lib/mediaIcon";

// Key → glyph. Simple, generic line icons (lucide) — one per matched
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
  // podcasts — from the feed's categories
  sport: Trophy,
  technology: Cpu,
  business: Briefcase,
  comedy: Laugh,
  education: GraduationCap,
  health: HeartPulse,
  music: Music,
  society: Globe,
  arts: Palette,
  science: FlaskConical,
  history: Hourglass,
  government: Landmark,
  fiction: BookOpen,
  film: Clapperboard,
  crime: Search,
  kids: Baby,
  leisure: Gamepad2,
  religion: Sparkles,
  // stations (genres; fm = generic)
  fm: Radio,
  ambient: Waves,
  jazz: Music,
  rock: Guitar,
  electronic: Disc3,
  classical: Piano,
  hiphop: MicVocal,
  space: Rocket,
  lounge: Coffee,
  folk: Wheat,
};

// Key → hue token (index.css --c-cat-*). One hint of colour per category so
// neighbouring tiles read apart; related subjects share a hue. `null` = the
// generic glyphs (default podcast, plain fm), which stay muted.
type Hue =
  | "red"
  | "pink"
  | "magenta"
  | "violet"
  | "indigo"
  | "blue"
  | "cyan"
  | "teal"
  | "green"
  | "lime"
  | "yellow";

const HUES: Record<MediaIconKey, Hue | null> = {
  bitcoin: null, // drawn as the brand mark instead — see BitcoinMark
  privacy: "violet",
  news: "blue",
  tree: "lime",
  duck: "yellow",
  host: "indigo",
  default: null,
  sport: "red",
  technology: "cyan",
  business: "teal",
  comedy: "yellow",
  education: "indigo",
  health: "pink",
  music: "magenta",
  society: "green",
  arts: "magenta",
  science: "cyan",
  history: "yellow",
  government: "blue",
  fiction: "violet",
  film: "pink",
  crime: "red",
  kids: "lime",
  leisure: "green",
  religion: "violet",
  fm: null,
  ambient: "cyan",
  jazz: "yellow",
  rock: "red",
  electronic: "magenta",
  classical: "indigo",
  hiphop: "pink",
  space: "violet",
  lounge: "teal",
  folk: "lime",
};

/** The Bitcoin symbol (bitcoin.design's visual-language asset): the orange disc
 *  with the white tilted ₿. Colours come from the --c-cat-bitcoin tokens. */
function BitcoinMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 144 145" aria-hidden>
      <path
        fill="rgb(var(--c-cat-bitcoin))"
        d="M141.845993,89.6650009c-9.6209869,38.5709915-48.6898956,62.0459976-87.2698898,52.4280014C16.0121002,132.4759979-7.46593,93.4079971,2.1570699,54.8390007,11.7711,16.2639999,50.8431015-7.2140098,89.4101028,2.4029901c38.5748978,9.6170104,62.0519028,48.6880095,52.4358902,87.2620108Z"
      />
      <path
        fill="rgb(var(--c-cat-bitcoin-fg))"
        d="M48.3110008,84.375c-.3920021.9720001-1.3850021,2.4309998-3.6210022,1.8769989.0790024.1139984-5.7449989-1.4329987-5.7449989-1.4329987l-3.9199982,9.0410004,10.2799988,2.5629959c1.9109993.4790039,3.7879982.9790039,5.632,1.4530029l-3.2670021,13.1269989,7.8910027,1.9690018,3.2369995-12.9869995c2.1580009.5839996,4.25,1.125,6.2980003,1.6340027l-3.2260017,12.9259949,7.8999977,1.9690018,3.2700043-13.1019974c13.4729996,2.5479965,23.6039963,1.5199966,27.8659973-10.663002,3.4370041-9.8099976-.1699982-15.4690018-7.2579956-19.1600037,5.1609955-1.1899948,9.0509949-4.5859985,10.0879974-11.5979958,1.4329987-9.5820007-5.862999-14.7310028-15.8379974-18.1669998l3.2350006-12.9780006-7.8990021-1.9689999-3.151001,12.6359997c-2.0790024-.5180016-4.2099991-1.0060005-6.3310013-1.4890022l3.1709976-12.7199974-7.8939972-1.9690018-3.2389984,12.9760017-15.9309998-3.9459991-2.1020012,8.4369965s5.8610001,1.3430023,5.7369995,1.427002c3.2000008.7989998,3.7770004,2.9160004,3.6809998,4.5940018l-8.8639984,35.5519981ZM85.6869965,87.302002c-2.4440002,9.810997-18.9599991,4.5069962-24.317997,3.1759949l4.3380013-17.3889999c5.3549957,1.3350067,22.5299988,3.9810028,19.9799957,14.2130051ZM88.1269989,61.8499985c-2.2259979,8.9240036-15.9749985,4.3889999-20.4349976,3.2770004l3.9319992-15.7719994c4.4589996,1.1119995,18.8239975,3.1870003,16.5029984,12.4949989Z"
      />
    </svg>
  );
}

/** A square media glyph with a hint of category colour. Square by construction.
 *  `bare` drops the inner tile (for cards that are themselves the grey tile);
 *  the icon keeps the same footprint and position either way. */
export function MediaGlyph({
  iconKey,
  size = 40,
  bare = false,
}: {
  iconKey: MediaIconKey;
  size?: number;
  bare?: boolean;
}) {
  const Icon = ICONS[iconKey];
  const hue = HUES[iconKey];
  return (
    <span
      className={cn(
        "grid aspect-square shrink-0 place-items-center",
        bare ? "" : "rounded-sm border border-surface bg-surface",
        hue ? "" : "text-muted",
      )}
      style={{
        width: size,
        height: size,
        color: hue ? `rgb(var(--c-cat-${hue}))` : undefined,
      }}
    >
      {iconKey === "bitcoin" ? (
        <BitcoinMark size={Math.round(size * 0.56)} />
      ) : (
        <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} />
      )}
    </span>
  );
}
