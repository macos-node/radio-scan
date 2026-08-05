import { Radio, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import type { Favorite, Station } from "../lib/tauri";
import { slugify } from "../lib/station";

/** The local curated favorites log — tracks you ♥'d while listening. "Tune"
 *  jumps to the station it was heard on (which is live, so it may be a different
 *  song now); the trash icon prunes the list. */
export function FavoritesDialog({
  favorites,
  onClose,
  onRemove,
  onTune,
}: {
  favorites: Favorite[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onTune: (station: Station) => void;
}) {
  const fmtTime = (ts: number) =>
    new Date(ts * 1000).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Modal
      title={`Favorites${favorites.length ? ` (${favorites.length})` : ""}`}
      onClose={onClose}
    >
      {favorites.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          No favorites yet — hit ♥ while a track is playing.
        </p>
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {favorites.map((f) => (
            <li
              key={f.id}
              className="group flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surfaceHover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">
                  {f.artist && <span className="text-mauve">{f.artist} </span>}
                  <span>
                    {f.artist ? "— " : ""}
                    {f.title}
                  </span>
                </div>
                <div className="truncate font-mono text-[10px] text-muted/70">
                  {f.station || "unknown"} · {fmtTime(f.ts)}
                </div>
              </div>
              <button
                type="button"
                title={f.station ? `Tune ${f.station}` : "Tune station"}
                onClick={() =>
                  onTune({
                    slug: slugify(f.station || f.url),
                    name: f.station || "Favorite",
                    url: f.url,
                    fmt: null,
                    bitrate: null,
                    tags: [],
                  })
                }
                className="shrink-0 rounded-sm p-1 text-muted opacity-0 transition hover:text-accent group-hover:opacity-100"
              >
                <Radio size={14} />
              </button>
              <button
                type="button"
                title="Remove favorite"
                onClick={() => onRemove(f.id)}
                className="shrink-0 rounded-sm p-1 text-muted opacity-0 transition hover:text-alert group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
