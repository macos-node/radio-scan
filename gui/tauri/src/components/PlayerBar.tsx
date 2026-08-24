import {
  Headphones,
  Heart,
  Loader2,
  Music,
  Pause,
  Play,
  Radio,
  RotateCcw,
  RotateCw,
  Volume2,
} from "lucide-react";
import type { NowPlaying } from "../lib/tauri";
import { SKIP_BACK, SKIP_FORWARD, type Playing } from "../lib/player";
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
  onSkip,
  onVolume,
  onFavorite,
  isFavorited,
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
  onSkip: (delta: number) => void;
  onVolume: (v: number) => void;
  onFavorite?: () => void;
  isFavorited?: boolean;
}) {
  const isEpisode = current?.kind === "episode";
  const canSkip = !!current?.seekable;

  /** A ⟲15 / ⟳30 jog button — the glyph with its step count inside it. Disabled
   *  for a live station, which has no timeline to move through. */
  const skipButton = (delta: number) => {
    const back = delta < 0;
    const secs = Math.abs(delta);
    return (
      <button
        type="button"
        onClick={() => onSkip(delta)}
        disabled={!canSkip}
        title={`${back ? "Back" : "Forward"} ${secs}s (${back ? "←" : "→"})`}
        aria-label={`Skip ${back ? "back" : "forward"} ${secs} seconds`}
        className={cn(
          "relative grid h-8 w-8 shrink-0 place-items-center rounded-full",
          "text-muted transition-colors hover:bg-surfaceHover hover:text-fg",
          "disabled:pointer-events-none disabled:opacity-30",
        )}
      >
        {back ? <RotateCcw size={18} /> : <RotateCw size={18} />}
        <span className="absolute font-mono text-[8px] leading-none">{secs}</span>
      </button>
    );
  };

  return (
    <footer className="flex items-center gap-4 border-t border-surface bg-panel px-4 py-3">
      <div className="flex shrink-0 items-center gap-1.5">
        {skipButton(-SKIP_BACK)}
        <button
          type="button"
          onClick={onToggle}
          disabled={!current}
          title={playing ? (isEpisode ? "Pause" : "Stop") : "Play"}
          aria-label={playing ? (isEpisode ? "Pause" : "Stop") : "Play"}
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
        {skipButton(SKIP_FORWARD)}
      </div>

      <div className="min-w-0 flex-1">
        {current ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              {isEpisode ? (
                <Headphones size={13} className="shrink-0 text-accent" />
              ) : (
                <Radio size={13} className="shrink-0 text-accent" />
              )}
              <span className="min-w-0 truncate text-sm text-fg">
                {current.title}
              </span>
              {isEpisode && current.subtitle && (
                <span className="shrink-0 max-w-[45%] truncate text-xs text-muted">
                  {current.subtitle}
                </span>
              )}
              {!isEpisode && playing && (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ok">
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
                  className="h-1 flex-1 cursor-pointer accent-fg"
                />
                <span className="w-9 shrink-0 font-mono text-[10px] text-muted">
                  {duration ? fmtTime(duration) : "—"}
                </span>
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

      {onFavorite && (
        <button
          type="button"
          onClick={onFavorite}
          disabled={!nowPlaying}
          title={isFavorited ? "Remove favorite" : "Favorite this track"}
          aria-label={isFavorited ? "Remove favorite" : "Favorite this track"}
          className={cn(
            "shrink-0 rounded-sm p-1.5 transition-colors",
            "disabled:pointer-events-none disabled:opacity-30",
            isFavorited ? "text-mauve" : "text-muted hover:text-mauve",
          )}
        >
          <Heart size={16} fill={isFavorited ? "currentColor" : "none"} />
        </button>
      )}

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
