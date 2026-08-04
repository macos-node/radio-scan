import { Loader2, Radio } from "lucide-react";
import type { Station } from "../lib/tauri";
import { cn } from "../lib/cn";

/** The tuner's station list. In U0 the rows come from the seed command; from U1
 *  they are `station.v1` events and each row's dot becomes the source-model dot
 *  (lib/source.ts) — live/off now, matched/unmatched against ndisc later. */
export function StationList({
  stations,
  currentSlug,
  playing,
  loading,
  onTune,
}: {
  stations: Station[];
  currentSlug: string | null;
  playing: boolean;
  loading: boolean;
  onTune: (s: Station) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" />
        loading stations…
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="p-4 text-sm text-muted">
        No stations yet. (U1 populates this from your followed{" "}
        <span className="font-mono text-nostr">station.v1</span> events.)
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {stations.map((s) => {
        const current = s.slug === currentSlug;
        return (
          <li key={s.slug}>
            <button
              type="button"
              onClick={() => onTune(s)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left",
                "border-l-2 border-transparent transition-colors",
                "hover:bg-surfaceHover",
                current && "border-accent bg-surface",
              )}
            >
              {/* Source dot — green when this station is the one playing. The
                  full lib/source.ts dot model lands with the relay data (U1). */}
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  current && playing ? "bg-ok" : "bg-muted/50",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <Radio
                    size={14}
                    className={cn(current ? "text-accent" : "text-muted")}
                  />
                  <span className="truncate text-sm text-fg">{s.name}</span>
                </span>
                {s.tags.length > 0 && (
                  <span className="mt-0.5 block truncate pl-6 text-xs text-muted">
                    {s.tags.join(" · ")}
                  </span>
                )}
              </span>
              {s.bitrate != null && (
                <span className="shrink-0 font-mono text-xs text-muted">
                  {s.bitrate}k
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
