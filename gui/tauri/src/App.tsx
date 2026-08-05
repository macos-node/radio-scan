import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Download,
  Headphones,
  Heart,
  KeyRound,
  Palette,
  Plus,
  Radio,
} from "lucide-react";
import { ToolbarIconButton } from "./components/ToolbarIconButton";
import { StationList } from "./components/StationList";
import { PodcastTab } from "./components/PodcastTab";
import { PlayerBar } from "./components/PlayerBar";
import { IdentityDialog } from "./components/IdentityDialog";
import { AddStationDialog } from "./components/AddStationDialog";
import { FavoritesDialog } from "./components/FavoritesDialog";
import {
  addFavorite,
  emitTrayNowPlaying,
  exportJson,
  getIdentity,
  getProxyPort,
  listFavorites,
  listLocalStations,
  onNowPlaying,
  onTrayFavorite,
  removeFavorite,
  removeLocalStation,
  streamUrl,
  unfollowStation,
  type Episode,
  type Favorite,
  type Identity,
  type NowPlaying,
  type Station,
} from "./lib/tauri";
import { resumePosition, savePosition, type Playing } from "./lib/player";
import { OWNER_PUBKEY } from "./lib/station";
import { useStations } from "./hooks/useStations";
import { shortVersion } from "./lib/format";
import { cn } from "./lib/cn";

const THEME_KEY = "ntune.theme";
const VOLUME_KEY = "ntune.volume";

/** Default = mono, like the rest of the suite; an existing choice is respected.
 *  Kept in step with the pre-paint script in index.html. */
type Theme = "fizx" | "upleb" | "mono";
const THEMES: Theme[] = ["mono", "fizx", "upleb"];
type Tab = "stations" | "podcasts";

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
  // The local, no-key station store (stations.json) — the always-available base
  // list. Seeded from the Rust seed set on first run; user adds/removes persist
  // to disk. The Nostr station.v1 list (relayStations) is an optional overlay.
  const [localStations, setLocalStations] = useState<Station[]>([]);
  const [tab, setTab] = useState<Tab>("stations");
  // Unified "what's playing" — a live station or a seekable episode (U4).
  const [current, setCurrent] = useState<Playing | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [volume, setVolume] = useState<number>(loadVolume);
  const [version, setVersion] = useState("");
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  // Now-playing parsed from a station's ICY metadata (U3); null for episodes /
  // metadata-less streams. Cleared on stop and source change.
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  // The playing URL, in a ref so the now-playing listener (registered once)
  // always matches the current source without re-subscribing.
  const currentUrlRef = useRef<string | null>(null);
  // Throttle episode-position saves.
  const lastSaveRef = useRef(0);
  const [showIdentity, setShowIdentity] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  // The local store is the base list; any Nostr station.v1 events (for signed-in
  // users) overlay on top, deduped by url. Local-first so an add always shows.
  const usingRelay = relayStations.length > 0;
  const stations = useMemo(() => {
    const seen = new Set<string>();
    const out: Station[] = [];
    for (const s of [...localStations, ...relayStations]) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      out.push(s);
    }
    return out;
  }, [localStations, relayStations]);
  const loading = localStations.length === 0 && relayLoading;

  /** Where the station list came from — shown next to the section header. */
  const source = useMemo(() => {
    const local = `${localStations.length} local`;
    if (usingRelay) return `${local} · +${relayStations.length} station.v1`;
    if (relayLoading) return `${local} · checking relays…`;
    return `${local} · saved on this device`;
  }, [localStations.length, usingRelay, relayStations.length, relayLoading]);

  // One hidden <audio> element drives all playback, fed through the Rust loopback
  // proxy (proxy.rs) so a packaged secure origin can play plain http:// without
  // mixed-content blocking. See streamUrl.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    listLocalStations()
      .then(setLocalStations)
      .catch((e) => console.error("list_local_stations failed", e));
    getIdentity()
      .then(setIdentity)
      .catch((e) => console.error("get_identity failed", e));
    getVersion().then(setVersion).catch(() => setVersion(""));
    getProxyPort()
      .then(setProxyPort)
      .catch((e) => console.error("proxy_port failed", e));
    listFavorites()
      .then(setFavorites)
      .catch((e) => console.error("list_favorites failed", e));
  }, []);

  // Keep the playing URL in a ref for the now-playing listener below.
  useEffect(() => {
    currentUrlRef.current = current?.url ?? null;
  }, [current]);

  // Subscribe once to ICY now-playing events; keep only those for what we're
  // currently playing (the proxy tags each event with its upstream url).
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

  // A newly-saved station (from AddStationDialog) — already persisted to the
  // local store by Rust; reflect it immediately, deduped by url + slug.
  const onAdded = useCallback((s: Station) => {
    setLocalStations((prev) => [
      s,
      ...prev.filter((p) => p.url !== s.url && p.slug !== s.slug),
    ]);
  }, []);

  // Remove a station: drop it from the local store (persisted), and if signed in
  // also publish a station.v1 unfollow so the Nostr overlay stays in step.
  const removeStation = useCallback(
    (s: Station) => {
      setLocalStations((prev) => prev.filter((p) => p.slug !== s.slug));
      removeLocalStation(s.slug).catch((e) =>
        console.error("remove_local_station failed", e),
      );
      if (identity) {
        unfollowStation(s.slug).catch((e) =>
          console.error("unfollow failed", e),
        );
      }
    },
    [identity],
  );

  // Export the current station list as JSON (native Save dialog). Exports the
  // merged, displayed list — the same rows the user sees.
  const exportStations = useCallback(() => {
    exportJson(
      "ntune-stations.json",
      stations.map((s) => ({
        slug: s.slug,
        name: s.name,
        url: s.url,
        fmt: s.fmt,
        bitrate: s.bitrate,
        tags: s.tags,
      })),
    ).catch((e) => console.error("export stations failed", e));
  }, [stations]);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (current?.kind === "episode") {
      savePosition(current.url, a.currentTime, a.duration || undefined);
    }
    a.pause();
    // Clearing the source halts a live stream's download — pause alone keeps
    // buffering it.
    a.removeAttribute("src");
    a.load();
    setPlaying(false);
    setBuffering(false);
    setNowPlaying(null);
    setPosition(0);
    setDuration(0);
  }, [current]);

  /** Core playback: load a source into the shared <audio> element. */
  const play = useCallback(
    (p: Playing) => {
      const a = audioRef.current;
      if (!a) return;
      setCurrent(p);
      setNowPlaying(null);
      setPosition(0);
      setDuration(0);
      setBuffering(true);
      // Only http:// needs the loopback proxy (mixed-content on a secure origin);
      // https:// plays directly. Fall back to direct if the port isn't ready.
      a.src =
        proxyPort != null && p.url.startsWith("http://")
          ? streamUrl(proxyPort, p.url)
          : p.url;
      a.volume = volume;
      a.play().catch((e) => {
        console.error("play failed", e);
        setBuffering(false);
        setPlaying(false);
      });
    },
    [proxyPort, volume],
  );

  const tune = useCallback(
    (s: Station) => {
      if (current?.kind === "station" && current.key === s.slug && playing) {
        stop();
        return;
      }
      play({ kind: "station", key: s.slug, title: s.name, url: s.url, seekable: false });
    },
    [current, playing, stop, play],
  );

  const playEpisode = useCallback(
    (ep: Episode, podcastTitle: string) => {
      if (current?.kind === "episode" && current.key === ep.id && playing) {
        stop();
        return;
      }
      play({
        kind: "episode",
        key: ep.id,
        title: ep.title,
        subtitle: podcastTitle,
        url: ep.enclosureUrl,
        seekable: true,
      });
    },
    [current, playing, stop, play],
  );

  const togglePlay = useCallback(() => {
    if (!current) return;
    if (playing) stop();
    else play(current);
  }, [current, playing, stop, play]);

  const seek = useCallback((secs: number) => {
    const a = audioRef.current;
    if (a) {
      a.currentTime = secs;
      setPosition(secs);
    }
  }, []);

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

  // --- favorites (local curated log) ----------------------------------------
  // Match by artist+title (the track), station-agnostic — "I like this track".
  const isFavorited = useMemo(
    () =>
      nowPlaying != null &&
      favorites.some(
        (f) => f.artist === nowPlaying.artist && f.title === nowPlaying.title,
      ),
    [favorites, nowPlaying],
  );

  const toggleFavorite = useCallback(async () => {
    if (!nowPlaying) return;
    const same = (f: Favorite) =>
      f.artist === nowPlaying.artist && f.title === nowPlaying.title;
    const dupes = favorites.filter(same);
    if (dupes.length) {
      setFavorites((prev) => prev.filter((f) => !same(f)));
      await Promise.all(
        dupes.map((f) =>
          removeFavorite(f.id).catch((e) =>
            console.error("remove favorite failed", e),
          ),
        ),
      );
    } else {
      try {
        const fav = await addFavorite({
          artist: nowPlaying.artist,
          title: nowPlaying.title,
          station: current?.title ?? "",
          url: current?.url ?? nowPlaying.url,
        });
        setFavorites((prev) => [fav, ...prev]);
      } catch (e) {
        console.error("add favorite failed", e);
      }
    }
  }, [nowPlaying, favorites, current]);

  const removeFav = useCallback((id: string) => {
    setFavorites((prev) => prev.filter((f) => f.id !== id));
    removeFavorite(id).catch((e) => console.error("remove favorite failed", e));
  }, []);

  // The tray's ♥ (U6, `--tray`) runs the SAME toggle as the in-window heart, so
  // both surfaces stay in step. Keep a ref to the latest toggleFavorite so the
  // listener — registered once — always sees current nowPlaying/favorites without
  // re-subscribing. A tray click with nothing playing is a harmless no-op.
  const toggleFavoriteRef = useRef(toggleFavorite);
  useEffect(() => {
    toggleFavoriteRef.current = toggleFavorite;
  }, [toggleFavorite]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onTrayFavorite(() => void toggleFavoriteRef.current())
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => console.error("tray-favorite listen failed", e));
    return () => unlisten?.();
  }, []);

  // Push the derived now-playing state to the tray (U6). The UI owns this — it
  // clears nowPlaying on stop and gates the ♥ on it — so the tray label and the
  // ♥-enabled state mirror the in-window heart. Harmless if launched without a
  // tray (nothing listens).
  useEffect(() => {
    const label = nowPlaying
      ? [nowPlaying.artist, nowPlaying.title].filter(Boolean).join(" — ")
      : playing && current
        ? current.title
        : "Not playing";
    void emitTrayNowPlaying({ label, canFavorite: nowPlaying != null });
  }, [nowPlaying, playing, current]);

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
            title={
              identity
                ? "Add a station (saved locally + published to relays)"
                : "Add a station (saved on this device)"
            }
            className="flex items-center gap-1 rounded-sm border border-transparent px-2 py-1 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
          >
            <Plus size={14} />
            Add
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
            icon={
              <Heart
                size={15}
                className={favorites.length ? "text-mauve" : undefined}
              />
            }
            title={`Favorites${favorites.length ? ` (${favorites.length})` : ""}`}
            onClick={() => setShowFavorites(true)}
          />
          <ToolbarIconButton
            icon={<Palette size={15} />}
            title={`Theme: ${theme} (click to cycle)`}
            onClick={cycleTheme}
          />
        </div>
      </header>

      {/* Body: Stations (radio) | Podcasts (RSS). npub-1063 feeds arrive in U4b. */}
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-surface px-2 py-1">
          {([
            { id: "stations", label: "Stations", icon: <Radio size={13} /> },
            { id: "podcasts", label: "Podcasts", icon: <Headphones size={13} /> },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
                tab === t.id
                  ? "bg-surface text-fg"
                  : "text-muted hover:bg-surfaceHover hover:text-fg",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "stations" ? (
            <section className="flex flex-col">
              <div className="flex items-center gap-2 px-3 pb-1 pt-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Stations
                </h2>
                <span className="font-mono text-[10px] text-muted/60">{source}</span>
                <button
                  type="button"
                  onClick={exportStations}
                  disabled={stations.length === 0}
                  title="Export stations as JSON"
                  className="ml-auto flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surfaceHover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                >
                  <Download size={12} />
                  Export
                </button>
              </div>
              <StationList
                stations={stations}
                currentSlug={current?.kind === "station" ? current.key : null}
                playing={playing}
                loading={loading}
                onTune={tune}
                onRemove={removeStation}
              />
            </section>
          ) : (
            <PodcastTab
              onPlayEpisode={playEpisode}
              currentKey={current?.kind === "episode" ? current.key : null}
              playing={playing}
            />
          )}
        </div>
      </main>

      <PlayerBar
        current={current}
        nowPlaying={nowPlaying}
        playing={playing}
        buffering={buffering}
        volume={volume}
        position={position}
        duration={duration}
        onToggle={togglePlay}
        onSeek={seek}
        onVolume={changeVolume}
        onFavorite={toggleFavorite}
        isFavorited={isFavorited}
      />

      {/* Hidden transport. Events keep React state in step with the element, and
          drive episode seek/resume (loadedmetadata / timeupdate / ended). */}
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
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          setDuration(Number.isFinite(a.duration) ? a.duration : 0);
          if (current?.kind === "episode") {
            const r = resumePosition(current.url);
            if (r > 0 && (!a.duration || r < a.duration - 15)) a.currentTime = r;
          }
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setPosition(a.currentTime);
          if (current?.kind === "episode") {
            const now = Date.now();
            if (now - lastSaveRef.current > 4000) {
              lastSaveRef.current = now;
              savePosition(current.url, a.currentTime, a.duration || undefined);
            }
          }
        }}
        onEnded={() => {
          if (current?.kind === "episode") savePosition(current.url, 0);
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
      {showFavorites && (
        <FavoritesDialog
          favorites={favorites}
          onClose={() => setShowFavorites(false)}
          onRemove={removeFav}
          onTune={(s) => {
            tune(s);
            setShowFavorites(false);
          }}
        />
      )}
      {showAdd && (
        <AddStationDialog
          hasIdentity={!!identity}
          onClose={() => setShowAdd(false)}
          onAdded={onAdded}
        />
      )}
    </div>
  );
}
