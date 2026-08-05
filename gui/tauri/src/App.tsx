import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { KeyRound, Palette, Plus, Radio } from "lucide-react";
import { ToolbarIconButton } from "./components/ToolbarIconButton";
import { StationList } from "./components/StationList";
import { PlayerBar } from "./components/PlayerBar";
import { IdentityDialog } from "./components/IdentityDialog";
import { AddStationDialog } from "./components/AddStationDialog";
import {
  getIdentity,
  getProxyPort,
  onNowPlaying,
  seedStations,
  streamUrl,
  unfollowStation,
  type Identity,
  type NowPlaying,
  type Station,
} from "./lib/tauri";
import { OWNER_PUBKEY } from "./lib/station";
import { useStations } from "./hooks/useStations";
import { shortVersion } from "./lib/format";

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
  // U2: read (and publish) the signed-in identity's own stations; with no key
  // set, fall back to reading the suite owner's published set.
  const [identity, setIdentity] = useState<Identity | null>(null);
  const ownerHex = identity?.pk ?? OWNER_PUBKEY;

  // U1: the station list is that pubkey's published `station.v1` (31241) events
  // off the relays. The Rust seed is the first-run fallback until any exist.
  const { stations: relayStations, loading: relayLoading } = useStations(
    ownerHex,
    true,
  );
  const [seed, setSeed] = useState<Station[]>([]);
  const [current, setCurrent] = useState<Station | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [volume, setVolume] = useState<number>(loadVolume);
  const [version, setVersion] = useState("");
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  // Now-playing parsed from the stream's ICY metadata (U3), or null when the
  // stream carries none / nothing's tuned. Cleared on stop and station change.
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  // The tuned station's URL, in a ref so the now-playing listener (registered
  // once) always matches against the current station without re-subscribing.
  const currentUrlRef = useRef<string | null>(null);
  // Stations just published this session — shown immediately (optimistic insert)
  // because the live subscription doesn't reliably echo your own fresh publish.
  const [optimistic, setOptimistic] = useState<Station[]>([]);
  const [showIdentity, setShowIdentity] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // Show published (followed) stations AND any seeds not already followed
  // (deduped by url), so the seed list stays visible after publishing instead of
  // being replaced — and stays testable.
  const usingRelay = relayStations.length > 0;
  // Published stations, then just-published (optimistic) ones the subscription
  // hasn't echoed yet, then seeds — deduped by url so nothing shows twice.
  const stations = useMemo(() => {
    const seen = new Set<string>();
    const out: Station[] = [];
    for (const s of [...relayStations, ...optimistic, ...seed]) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      out.push(s);
    }
    return out;
  }, [relayStations, optimistic, seed]);
  const loading = !usingRelay && seed.length === 0 && relayLoading;

  /** Where the visible list came from — surfaced next to the section header. */
  const source = useMemo(() => {
    if (usingRelay) return `${relayStations.length} · station.v1 (relays)`;
    if (relayLoading) return "seed · checking relays…";
    return "seed · no published stations yet";
  }, [usingRelay, relayStations.length, relayLoading]);

  // One hidden <audio> element drives all playback, fed through the Rust
  // loopback proxy (src-tauri/src/proxy.rs) so a packaged secure origin can play
  // plain http:// streams without mixed-content blocking. See streamUrl.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    seedStations()
      .then(setSeed)
      .catch((e) => console.error("seed_stations failed", e));
    getIdentity()
      .then(setIdentity)
      .catch((e) => console.error("get_identity failed", e));
    getVersion().then(setVersion).catch(() => setVersion(""));
    getProxyPort()
      .then(setProxyPort)
      .catch((e) => console.error("proxy_port failed", e));
  }, []);

  // Keep the current-station URL in a ref for the now-playing listener below.
  useEffect(() => {
    currentUrlRef.current = current?.url ?? null;
  }, [current]);

  // Subscribe once to ICY now-playing events; keep only those for the station
  // we're currently tuned to (the proxy tags each event with its upstream url).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onNowPlaying((np) => {
      if (np.url === currentUrlRef.current) setNowPlaying(np);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => console.error("now-playing listen failed", e));
    return () => unlisten?.();
  }, []);

  // Unfollow = publish a kind:5 delete; the live subscription drops it on read.
  const unfollow = useCallback(
    (s: Station) => {
      if (!identity) return;
      setOptimistic((prev) => prev.filter((p) => p.url !== s.url));
      unfollowStation(s.slug).catch((e) => console.error("unfollow failed", e));
    },
    [identity],
  );

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
    setNowPlaying(null);
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
      setNowPlaying(null);
      setBuffering(true);
      // Only http:// streams need the loopback proxy (mixed-content on a secure
      // origin); https:// plays directly. Fall back to direct if the port isn't
      // ready yet.
      a.src =
        proxyPort != null && s.url.startsWith("http://")
          ? streamUrl(proxyPort, s.url)
          : s.url;
      a.volume = volume;
      a.play().catch((e) => {
        console.error("play failed", e);
        setBuffering(false);
        setPlaying(false);
      });
    },
    [current, playing, stop, volume, proxyPort],
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
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            disabled={!identity}
            title={
              identity ? "Follow a station" : "Set a signing key to follow stations"
            }
            className="flex items-center gap-1 rounded-sm border border-transparent px-2 py-1 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus size={14} />
            Follow
          </button>
          <button
            type="button"
            onClick={() => setShowIdentity(true)}
            title={identity ? `Signed in — ${identity.npub}` : "No signing key"}
            className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
          >
            <KeyRound size={14} className={identity ? "text-nostr" : undefined} />
            <span className="font-mono">
              {identity ? `${identity.npub.slice(0, 12)}…` : "no key"}
            </span>
          </button>
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
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Stations
            </h2>
            <span className="font-mono text-[10px] text-muted/60">{source}</span>
          </div>
          <StationList
            stations={stations}
            currentSlug={current?.slug ?? null}
            playing={playing}
            loading={loading}
            onTune={tune}
            onUnfollow={identity && usingRelay ? unfollow : undefined}
          />
        </section>
      </main>

      <PlayerBar
        station={current}
        nowPlaying={nowPlaying}
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

      {showIdentity && (
        <IdentityDialog
          identity={identity}
          onClose={() => setShowIdentity(false)}
          onChange={setIdentity}
        />
      )}
      {showAdd && (
        <AddStationDialog
          onClose={() => setShowAdd(false)}
          onPublished={(s) =>
            setOptimistic((prev) => [s, ...prev.filter((p) => p.url !== s.url)])
          }
        />
      )}
    </div>
  );
}
