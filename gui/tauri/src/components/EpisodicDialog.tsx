import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "./Modal";
import type { EpisodicShow } from "../lib/tauri";
import { cn } from "../lib/cn";

/** The latest episode of each weekly show the local logger has captured — the
 *  read half of the logger surface, and what RadioBar has shown on macOS from the
 *  start while Linux had no way to see it at all.
 *
 *  READ-ONLY over the parsers' logs. Nothing here fetches, and nothing here
 *  writes: a stale view means the weekly timer hasn't run, which the tray's
 *  LOGGER section is the place to do something about.
 *
 *  On the link: On The Wire publishes tracklists and no audio, so the only honest
 *  action is to send you where the audio actually is. A show with no captured link
 *  says so rather than offering a dead button. */
export function EpisodicDialog({
  shows,
  unseen,
  onClose,
  onRefresh,
  onSeen,
}: {
  shows: EpisodicShow[];
  /** Show ids whose newest episode hasn't been looked at yet. */
  unseen: string[];
  onClose: () => void;
  onRefresh: () => void;
  onSeen: (id: string, date: string) => void;
}) {
  // Open on something NEW when there is one, rather than always the first show:
  // the badge is what brought you here, so the first thing shown should be what
  // it was pointing at.
  const [active, setActive] = useState(
    shows.find((s) => unseen.includes(s.id))?.id ?? shows[0]?.id ?? "",
  );
  const show = shows.find((s) => s.id === active) ?? shows[0];

  // Displaying an episode is what marks it seen — not opening the dialog. A show
  // you never switched to keeps its dot.
  useEffect(() => {
    if (show?.date) onSeen(show.id, show.date);
  }, [show?.id, show?.date, onSeen]);

  if (!show) {
    return (
      <Modal title="Latest episodes" onClose={onClose}>
        <p className="py-6 text-center text-xs text-muted">
          No episode logs on this machine yet.
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Latest episodes" onClose={onClose}>
      <div className="mb-3 flex items-center gap-1">
        {shows.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            className={cn(
              "rounded-sm px-2 py-1 text-xs transition-colors",
              s.id === show.id
                ? "bg-surface text-fg"
                : "text-muted hover:bg-surfaceHover hover:text-fg",
            )}
          >
            {s.label}
            {unseen.includes(s.id) && (
              <span
                aria-hidden="true"
                className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle"
              />
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={onRefresh}
          title="Re-read the logs"
          aria-label="Re-read the logs"
          className="ml-auto grid h-7 w-7 place-items-center rounded-sm text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="mb-2">
        <p className="text-sm font-medium leading-snug">{show.episode || "—"}</p>
        <p className="font-mono text-[11px] text-muted">
          {show.date} · {show.tracks.length} tracks · {show.episodes} episodes logged
        </p>
      </div>

      {show.listen_url ? (
        <button
          type="button"
          onClick={() => void openUrl(show.listen_url)}
          className="mb-3 flex items-center gap-1.5 rounded-sm border border-surface px-2 py-1 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
        >
          <ExternalLink size={13} />
          Listen on Mixcloud
        </button>
      ) : (
        /* Not a failure: the feed simply carries no link for this one, and saying
           so beats a button that goes nowhere. */
        <p className="mb-3 text-[11px] text-muted">No listen link for this episode.</p>
      )}

      {show.tracks.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          No tracks parsed for this episode.
        </p>
      ) : (
        <ol className="max-h-[45vh] space-y-1 overflow-y-auto">
          {show.tracks.map((t, i) => (
            <li
              key={`${t.pos}-${i}`}
              className="flex gap-2 rounded-sm px-1 py-0.5 text-xs hover:bg-surfaceHover"
            >
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted">
                {t.pos}
              </span>
              <span className="min-w-0">
                <span className="text-fg">{t.artist}</span>
                <span className="text-muted"> — {t.title}</span>
                {t.detail && (
                  <span className="block truncate text-[11px] text-muted">
                    {t.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
