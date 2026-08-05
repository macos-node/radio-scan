import { Headphones, Loader2, Music, Pause, Play, Radio, Volume2 } from "lucide-react";
import type { NowPlaying } from "../lib/tauri";
import type { Playing } from "../lib/player";
import { cn } from "../lib/cn";

function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** The bottom transport. Handles both source types: a live station (with the
 *  ICY now-playing label, U3) and a podcast episode (with a seek bar). Playback
 *  is driven by the parent's hidden <audio> — this is presentation + controls. */
export function PlayerBar({
  current,
  nowPlaying,
  playing,
  buffering,
  volume,
  position,
  duration,
  onToggle,
  onSeek,
  onVolume,
}: {
  current: Playing | null;
  nowPlaying: NowPlaying | null;
  playing: boolean;
  buffering: boolean;
  volume: number;
  position: number;
  duration: number;
  onToggle: () => void;
  onSeek: (secs: number) => void;
  onVolume: (v: number) => void;
}) {
  const isEpisode = current?.kind === "episode";

  return (
    <footer className="flex items-center gap-4 border-t border-surface bg-panel px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={!current}
        title={playing ? "Stop" : "Play"}
        aria-label={playing ? "Stop" : "Play"}
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full",
          "bg-accent text-bg transition-opacity",
          "disabled:pointer-events-none disabled:opacity-30",
        )}
      >
        {buffering ? (
          <Loader2 size={18} className="animate-spin" />
        ) : playing ? (
          <Pause size={18} />
        ) : (
          <Play size={18} className="translate-x-px" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {current ? (
          <>
            <div className="flex items-center gap-2">
              {isEpisode ? (
                <Headphones size={13} className="shrink-0 text-accent" />
              ) : (
                <Radio size={13} className="shrink-0 text-accent" />
              )}
              <span className="truncate text-sm text-fg">{current.title}</span>
              {!isEpisode && playing && (
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ok">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
                  live
                </span>
              )}
            </div>

            {isEpisode ? (
              /* Episode: seek bar + times. */
              <div className="mt-1 flex items-center gap-2">
                <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted">
                  {fmtTime(position)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={1}
                  value={Math.min(position, duration || 0)}
                  onChange={(e) => onSeek(Number(e.target.value))}
                  aria-label="Seek"
                  className="h-1 flex-1 cursor-pointer accent-accent"
                />
                <span className="w-9 shrink-0 font-mono text-[10px] text-muted">
                  {duration ? fmtTime(duration) : "—"}
                </span>
                {current.subtitle && (
                  <span className="ml-1 hidden max-w-[40%] truncate text-xs text-muted sm:inline">
                    {current.subtitle}
                  </span>
                )}
              </div>
            ) : nowPlaying ? (
              /* Station: ICY now-playing (U3). */
              <div className="flex items-center gap-1.5 truncate text-xs">
                <Music size={11} className="shrink-0 text-mauve" />
                {nowPlaying.artist && (
                  <span className="shrink-0 truncate text-mauve">
                    {nowPlaying.artist}
                  </span>
                )}
                <span className="truncate text-fg">
                  {nowPlaying.artist ? "— " : ""}
                  {nowPlaying.title}
                </span>
              </div>
            ) : (
              <div className="truncate text-xs text-muted">
                stream
                {playing ? (
                  <span className="text-muted/60"> · waiting for track info…</span>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-muted">
            Select a station or episode to play
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Volume2 size={15} className="text-muted" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          aria-label="Volume"
          className="h-1 w-24 cursor-pointer accent-accent"
        />
      </div>
    </footer>
  );
}
