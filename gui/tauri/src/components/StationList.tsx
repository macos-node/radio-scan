import { Loader2, Radio, X } from "lucide-react";
import type { Station } from "../lib/tauri";
import { cn } from "../lib/cn";

/** The tuner's station list. Rows are the user's `station.v1` events (or the
 *  seed fallback). When `onUnfollow` is provided (the signed-in owner's own
 *  relay list), each row gets a hover ✕ that publishes a kind:5 delete. */
export function StationList({
  stations,
  currentSlug,
  playing,
  loading,
  onTune,
  onUnfollow,
}: {
  stations: Station[];
  currentSlug: string | null;
  playing: boolean;
  loading: boolean;
  onTune: (s: Station) => void;
  onUnfollow?: (s: Station) => void;
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
        No stations. Use <span className="text-fg">Follow</span> to publish a{" "}
        <span className="font-mono text-nostr">station.v1</span> and read it back
        here.
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {stations.map((s) => {
        const current = s.slug === currentSlug;
        return (
          <li key={s.slug} className="group relative flex items-stretch">
            <button
              type="button"
              onClick={() => onTune(s)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left",
                "border-l-2 border-transparent transition-colors",
                "hover:bg-surfaceHover",
                current && "border-accent bg-surface",
              )}
            >
              {/* Source dot — green when this station is the one playing. The
                  full lib/source.ts dot model lands with matched/unmatched. */}
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
            {onUnfollow && (
              <button
                type="button"
                onClick={() => onUnfollow(s)}
                title={`Unfollow ${s.name}`}
                aria-label={`Unfollow ${s.name}`}
                className="grid w-8 shrink-0 place-items-center text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
