import { Loader2, Pause, Play, Radio, Volume2 } from "lucide-react";
import type { Station } from "../lib/tauri";
import { cn } from "../lib/cn";

/** The bottom transport. In U0 it shows the tuned station and a live indicator;
 *  the now-playing "Artist – Title" label arrives in U3 off the loopback ICY
 *  proxy (or `airplay.v1` off the relays). Playback is driven by the parent's
 *  hidden <audio> element — this is presentation + controls only. */
export function PlayerBar({
  station,
  playing,
  buffering,
  volume,
  onToggle,
  onVolume,
}: {
  station: Station | null;
  playing: boolean;
  buffering: boolean;
  volume: number;
  onToggle: () => void;
  onVolume: (v: number) => void;
}) {
  return (
    <footer className="flex items-center gap-4 border-t border-surface bg-panel px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={!station}
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
        {station ? (
          <>
            <div className="flex items-center gap-2">
              <Radio size={13} className="shrink-0 text-accent" />
              <span className="truncate text-sm text-fg">{station.name}</span>
              {playing && (
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ok">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
                  live
                </span>
              )}
            </div>
            {/* Placeholder for the U3 now-playing ticker. */}
            <div className="truncate text-xs text-muted">
              {station.fmt ?? "stream"}
              {station.bitrate != null ? ` · ${station.bitrate}k` : ""}
              <span className="text-muted/60"> · track metadata in U3</span>
            </div>
          </>
        ) : (
          <span className="text-sm text-muted">Select a station to tune in</span>
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
