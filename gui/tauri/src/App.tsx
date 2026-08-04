import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Palette, Radio } from "lucide-react";
import { ToolbarIconButton } from "./components/ToolbarIconButton";
import { StationList } from "./components/StationList";
import { PlayerBar } from "./components/PlayerBar";
import { seedStations, type Station } from "./lib/tauri";
import { shortVersion } from "./lib/format";
import { cn } from "./lib/cn";

const THEME_KEY = "ntune.theme";
const VOLUME_KEY = "ntune.volume";

/** Default = mono, like the rest of the suite; an existing choice is respected.
 *  Kept in step with the pre-paint script in index.html. */
type Theme = "fizx" | "upleb" | "mono";
const THEMES: Theme[] = ["mono", "fizx", "upleb"];

function loadTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "upleb" || v === "fizx" ? v : "mono";
}

function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle("theme-upleb", t === "upleb");
  el.classList.toggle("theme-mono", t === "mono");
}

function loadVolume(): number {
  const v = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.9;
}

export default function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Station | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [volume, setVolume] = useState<number>(loadVolume);
  const [version, setVersion] = useState("");

  // One hidden <audio> element drives all playback. Remote HTTP streams play
  // directly in WebKit2GTK — the asset-protocol limitation nplay routes around
  // is local-file-only, so U0 needs no Rust audio backend.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    seedStations()
      .then(setStations)
      .catch((e) => console.error("seed_stations failed", e))
      .finally(() => setLoading(false));
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    // Clearing the source actually halts a live stream's download — pause alone
    // keeps buffering it.
    a.removeAttribute("src");
    a.load();
    setPlaying(false);
    setBuffering(false);
  }, []);

  const tune = useCallback(
    (s: Station) => {
      const a = audioRef.current;
      if (!a) return;
      // Re-tapping the current, playing station toggles it off.
      if (current?.slug === s.slug && playing) {
        stop();
        return;
      }
      setCurrent(s);
      setBuffering(true);
      a.src = s.url;
      a.volume = volume;
      a.play().catch((e) => {
        console.error("play failed", e);
        setBuffering(false);
        setPlaying(false);
      });
    },
    [current, playing, stop, volume],
  );

  const togglePlay = useCallback(() => {
    if (!current) return;
    if (playing) stop();
    else tune(current);
  }, [current, playing, stop, tune]);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    localStorage.setItem(VOLUME_KEY, String(v));
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((t) => {
      const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-surface bg-panel px-4 py-2">
        <Radio size={18} className="text-accent" />
        <h1 className="text-sm font-semibold tracking-tight">ntune</h1>
        {version && (
          <span
            title={`radio-scan L4 UI · v${version}`}
            className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted"
          >
            {shortVersion(version)}
          </span>
        )}
        <span className="text-xs text-muted">radio-scan · tuner</span>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarIconButton
            icon={<Palette size={15} />}
            title={`Theme: ${theme} (click to cycle)`}
            onClick={cycleTheme}
          />
        </div>
      </header>

      {/* Body: station list (radio-first spine). Podcast / npub-feed tabs arrive
          in U4 — see docs/radio-scan-ui-2026-08-04.md. */}
      <main className="flex min-h-0 flex-1">
        <section className="flex w-full min-w-0 flex-col overflow-y-auto">
          <div className="flex items-center gap-2 px-3 pb-1 pt-3">
            <h2
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wide text-muted",
              )}
            >
              Stations
            </h2>
            <span className="font-mono text-[10px] text-muted/60">
              seed · U1 → station.v1
            </span>
          </div>
          <StationList
            stations={stations}
            currentSlug={current?.slug ?? null}
            playing={playing}
            loading={loading}
            onTune={tune}
          />
        </section>
      </main>

      <PlayerBar
        station={current}
        playing={playing}
        buffering={buffering}
        volume={volume}
        onToggle={togglePlay}
        onVolume={changeVolume}
      />

      {/* Hidden transport. Event wiring keeps React state in step with the
          element's real playback state (buffering vs playing vs errored). */}
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          setBuffering(false);
        }}
        onWaiting={() => setBuffering(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setBuffering(false);
          setPlaying(false);
        }}
      />
    </div>
  );
}
