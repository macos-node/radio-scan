import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Archive,
  Download,
  Headphones,
  Heart,
  KeyRound,
  Palette,
  Plus,
  Radio,
  Upload,
} from "lucide-react";
import { ToolbarIconButton } from "./components/ToolbarIconButton";
import { StationList } from "./components/StationList";
import { PodcastTab } from "./components/PodcastTab";
import { PlayerBar } from "./components/PlayerBar";
import { IdentityDialog } from "./components/IdentityDialog";
import { AddStationDialog } from "./components/AddStationDialog";
import { FavoritesDialog } from "./components/FavoritesDialog";
import { BackupDialog } from "./components/BackupDialog";
import {
  addFavorite,
  exportJson,
  getIdentity,
  getProxyPort,
  importJson,
  importLocalStations,
  listFavorites,
  cachedPodcasts,
  listLocalStations,
  publishStation,
  onNowPlaying,
  onTrayFavorite,
  removeFavorite,
  removeLocalStation,
  setStationHarvest,
  stationIcy,
  streamUrl,
  unfollowStation,
  writeNowPlaying,
  type Episode,
  type Favorite,
  type Identity,
  type IcyInfo,
  type NowPlaying,
  type Station,
} from "./lib/tauri";
import { absorbPodcast, initSubs, loadSubs } from "./lib/podcasts";
import {
  getSetting,
  initSettings,
  setSetting,
  SETTINGS_EVENT,
  THEME_KEY,
  VOLUME_KEY,
} from "./lib/settings";
import { resumePosition, savePosition, type Playing } from "./lib/player";
import { OWNER_PUBKEY, parseStationsJson, toExportStation } from "./lib/station";
import { useFollows } from "./hooks/useFollows";
import { shortVersion } from "./lib/format";
import { cn } from "./lib/cn";

/** Default = mono, like the rest of the suite; an existing choice is respected.
 *  Kept in step with the pre-paint script in index.html. */
type Theme = "fizx" | "upleb" | "mono";
const THEMES: Theme[] = ["mono", "fizx", "upleb"];
type Tab = "stations" | "podcasts";

function loadTheme(): Theme {
  const v = getSetting(THEME_KEY);
  return v === "upleb" || v === "fizx" ? v : "mono";
}

function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle("theme-upleb", t === "upleb");
  el.classList.toggle("theme-mono", t === "mono");
}

function loadVolume(): number {
  // Unset (fresh install) → the 0.9 default, NOT muted. The old code read
  // localStorage directly and let `Number(null) === 0` slip past the range
  // guard, so a first run started silent; guard the empty case explicitly.
  const raw = getSetting(VOLUME_KEY);
  if (raw == null || raw === "") return 0.9;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.9;
}

export default function App() {
  // U2: read (and publish) the signed-in identity's own stations; with no key
  // set, fall back to reading the suite owner's published set.
  const [identity, setIdentity] = useState<Identity | null>(null);
  const ownerHex = identity?.pk ?? OWNER_PUBKEY;

  // U1: the station list is that pubkey's published `station.v1` (31241) events
  // off the relays. The Rust seed is the first-run fallback until any exist.
  const {
    stations: relayStations,
    shows: relayShows,
    loading: relayLoading,
    superseded,
    refresh: refreshFollows,
  } = useFollows(ownerHex, true);
  // The local, no-key station store (stations.json) — the always-available base
  // list. Seeded from the Rust seed set on first run; user adds/removes persist
  // to disk. The Nostr station.v1 list (relayStations) is an optional overlay.
  const [localStations, setLocalStations] = useState<Station[]>([]);
  // Transient status shown by the stations header (import result / error).
  const [stationMsg, setStationMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stations");
  // Unified "what's playing" — a live station or a seekable episode (U4).
  const [current, setCurrent] = useState<Playing | null>(null);
  // Win #2: ICY headers captured per stream URL when tuned (homepage/genre/etc).
  const [icyByUrl, setIcyByUrl] = useState<Record<string, IcyInfo>>({});
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
  const [showBackup, setShowBackup] = useState(false);

  // The local store is the base list; any Nostr station.v1 events (for signed-in
  // users) overlay on top, deduped by url. Local-first so an add always shows.
  const usingRelay = relayStations.length > 0;
  const stations = useMemo(() => {
    // A station usually exists in BOTH stores — added locally, then published —
    // and the local copy wins the dedupe. Carry the relay twin's event id across
    // so an unfollow can still name the concrete event in an `e` tag; without
    // this, the common case would only ever get the `a` coordinate.
    const relayByUrl = new Map<string, Station>();
    for (const r of relayStations) relayByUrl.set(r.url, r);
    const localUrls = new Set(localStations.map((s) => s.url));

    const seen = new Set<string>();
    const out: Station[] = [];
    for (const s of [...localStations, ...relayStations]) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      const twin = relayByUrl.get(s.url);
      // `eventId` and `d` come from the published event even when the local copy
      // wins the dedupe — without them a retraction cannot name what it deletes.
      const eventId = s.eventId ?? twin?.eventId;
      const d = s.d ?? twin?.d;
      const relayOnly = !localUrls.has(s.url);
      out.push({
        ...s,
        ...(eventId ? { eventId } : {}),
        ...(d ? { d } : {}),
        ...(relayOnly ? { relayOnly: true } : {}),
      });
    }
    return out;
  }, [localStations, relayStations]);
  const loading = localStations.length === 0 && relayLoading;

  // A follow published at two addresses means a device is running a build older
  // than the contract (decision #11). Say so once, plainly, rather than showing the
  // duplicates as ordinary rows — which is how the 2026-08-19 skew went unnoticed
  // until the expected hashes were checked by hand.
  const skewWarning = useMemo(() => {
    if (superseded.size === 0) return null;
    const n = superseded.size;
    return `${n} follow${n === 1 ? "" : "s"} published twice — a device is on an older build. Unpublish and re-publish from the newest one.`;
  }, [superseded]);

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
    // Load the durable podcast store (podcasts.json) and migrate any legacy
    // localStorage subs on the first launch after the Rust store landed.
    initSubs()
      .then(async () => {
        // Heal any harvest the store missed while the Podcasts tab was closed. The
        // Rust feed-cache is written by every fetch regardless of what is mounted,
        // so it is the record of what the app already knows; folding it in at
        // startup means an export never ships a store thinner than the app's own
        // knowledge — H3's promise is export == PERSISTED state, and this is what
        // keeps "persisted" from quietly meaning "whatever the last mounted tab
        // happened to record".
        const urls = loadSubs().map((s) => s.url);
        if (urls.length === 0) return;
        const cached = await cachedPodcasts(urls);
        // Only bodies this build can still read. A stale one was parsed by an older
        // extractor, so folding it in would re-assert a superseded parse — the exact
        // way the owner-precedence fix stayed invisible. Those refresh on next fetch.
        const healed = cached
          .filter((c) => !c.stale)
          .filter((c) => absorbPodcast(c.url, c.podcast)).length;
        if (healed > 0) {
          console.info(`harvest: folded ${healed} cached feed(s) into the store`);
        }
      })
      .catch((e) => console.error("initSubs failed", e));
    // Same for UI prefs (theme / volume / list-view) — settings.json.
    initSettings().catch((e) => console.error("initSettings failed", e));
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
  // Remove from THIS DEVICE only. Retracting the published follow is
  // unpublishStation's job — decision #11 step 2. Conflating them meant a user
  // could not tidy a local list without telling every other device, nor stop
  // publishing a station without losing it here; the Podcasts tab was split this
  // way on 2026-08-19 and stations were the last holdout.
  const removeStation = useCallback((s: Station) => {
    setLocalStations((prev) => prev.filter((p) => p.slug !== s.slug));
    removeLocalStation(s.slug).catch((e) =>
      console.error("remove_local_station failed", e),
    );
  }, []);

  /** Publish this station as a `station.v1` follow. */
  const publishStationRow = useCallback(
    (s: Station) =>
      publishStation({
        slug: s.slug,
        name: s.name,
        url: s.url,
        fmt: s.fmt,
        bitrate: s.bitrate,
        tags: s.tags,
        description: s.description ?? "",
      })
        .then(() => refreshFollows())
        .catch((e) => console.error("publish_station failed", e)),
    [refreshFollows],
  );

  /** Retract the published follow, leaving the local row alone. Targets the
   *  address the event actually occupies (`s.d`) — see 468aff7. */
  const unpublishStation = useCallback(
    (s: Station) =>
      unfollowStation(s.url, s.eventId, s.d)
        .then(() => refreshFollows())
        .catch((e) => console.error("unfollow failed", e)),
    [refreshFollows],
  );

  // Export the current station list as JSON (native Save dialog). Exports the
  // merged, displayed list — the same rows the user sees.
  const exportStations = useCallback(() => {
    // One shared shape (lib/station.ts) so the tab export and the app-level backup
    // cannot drift apart, and so a newly stored field is either exported or fails a
    // test — never quietly dropped, which is how `harvest` would have been lost.
    exportJson("ntune-stations.json", stations.map(toExportStation)).catch((e) =>
      console.error("export stations failed", e),
    );
  }, [stations]);

  const flashStationMsg = useCallback((m: string) => {
    setStationMsg(m);
    setTimeout(() => setStationMsg((cur) => (cur === m ? null : cur)), 3500);
  }, []);

  // Import stations from a JSON file (native Open dialog) and merge into the
  // local store. Accepts our own export shape or a minimal [{name,url}] — a
  // missing slug is derived from the name, descriptive fields default.
  const importStations = useCallback(async () => {
    try {
      const data = await importJson<unknown>();
      if (data == null) return; // cancelled
      const incoming = parseStationsJson(data);
      if (incoming.length === 0) throw new Error("no valid stations in file");
      const merged = await importLocalStations(incoming);
      setLocalStations(merged);
      flashStationMsg(`imported ${incoming.length}`);
    } catch (e) {
      flashStationMsg(`import failed: ${e}`);
    }
  }, [flashStationMsg]);

  // App-level restore (Backup dialog): merge stations into the local store.
  const restoreStations = useCallback(async (incoming: Station[]) => {
    const merged = await importLocalStations(incoming);
    setLocalStations(merged);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  // When the durable settings store finishes loading (initSettings), re-sync
  // theme + volume to the now-authoritative values — covers a migration and the
  // rare case a non-graceful exit left the localStorage mirror one change stale.
  useEffect(() => {
    const onSettings = () => {
      setTheme(loadTheme());
      setVolume(loadVolume());
    };
    window.addEventListener(SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings);
  }, []);

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
      // Win #2: probe the stream's ICY headers once to enrich the station
      // (homepage / live genre / description). Best-effort; failures are ignored.
      //
      // U4.5: the probe is also PERSISTED against the local row, so what the stream
      // said survives a restart. It used to live only in this component's state, so
      // a station's homepage and genre vanished on every quit and came back only
      // after tuning in again.
      if (!icyByUrl[s.url]) {
        // Every outcome says something. A silent catch here cost real debugging
        // time on 2026-08-19: a probe that failed and a probe that never ran looked
        // identical from outside the app, so the only way to tell them apart was
        // watching stations.json for a write that might never come.
        stationIcy(s.url)
          .then((info) => {
            setIcyByUrl((m) => ({ ...m, [s.url]: info }));
            const harvest = {
              ...(info.name ? { icyName: info.name } : {}),
              ...(info.genre ? { genre: info.genre } : {}),
              ...(info.bitrate != null ? { bitrate: info.bitrate } : {}),
              ...(info.homepage ? { homepage: info.homepage } : {}),
              ...(info.fmt ? { fmt: info.fmt } : {}),
              probedAt: Math.floor(Date.now() / 1000),
            };
            // A slice with nothing but a timestamp says nothing — don't store it,
            // but do say so: "the server advertises nothing" is a real answer and
            // otherwise indistinguishable from a broken write path.
            if (Object.keys(harvest).length === 1) {
              console.info(`icy: ${s.slug} advertises no metadata — nothing to store`);
              return;
            }
            setStationHarvest(s.slug, harvest)
              .then((stored) => {
                if (!stored) {
                  // No local row (a relay-only station), or the slice is unchanged.
                  console.info(`icy: ${s.slug} not stored — no local row, or unchanged`);
                  return;
                }
                // Re-read the store into state. Writing through to Rust without
                // this left React holding stations with no harvest, and the export
                // maps over state — so a backup taken mid-session dropped every
                // slice while stations.json was perfectly correct (macOS
                // 2026-08-19). Same shape as useFollows.refresh(): after a
                // write-through, re-ask rather than assume.
                listLocalStations()
                  .then(setLocalStations)
                  .catch((e) => console.error("re-reading stations failed", e));
              })
              .catch((e) => console.error(`icy: storing ${s.slug} failed`, e));
          })
          .catch((e) => console.warn(`icy: probing ${s.slug} failed`, e));
      }
    },
    [current, playing, stop, play, icyByUrl],
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
    const a = audioRef.current;
    if (playing) {
      // Episodes PAUSE in place — keep the src + position so the progress bar
      // holds its fill and marker. Stations STOP (clearing src halts the live
      // stream's download; there's no progress to preserve).
      if (current.kind === "episode" && a) {
        savePosition(current.url, a.currentTime, a.duration || undefined);
        a.pause();
      } else {
        stop();
      }
    } else if (current.kind === "episode" && a && a.getAttribute("src")) {
      // Resume a paused episode where it left off, without reloading.
      a.play().catch(() => play(current));
    } else {
      play(current);
    }
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
    setSetting(VOLUME_KEY, String(v));
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((t) => {
      const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
      setSetting(THEME_KEY, next);
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

  // Bridge: write the derived now-playing state to the shared file — the single
  // source every surface reads. RadioBar (macOS) and ntune's own tray both poll
  // `nowplaying.json`; for episodes a consumer joins `r` to a logged tracklist
  // (macOS-only). The UI owns the derivation — it clears nowPlaying on stop and
  // gates the ♥ on it — so the file faithfully reflects the in-window state.
  // Best-effort: a failed write never disrupts playback.
  useEffect(() => {
    void writeNowPlaying({
      kind: current?.kind ?? "station",
      key: current?.key ?? "",
      r: current?.url ?? "",
      title: current?.title ?? "",
      subtitle: current?.subtitle,
      artist: nowPlaying?.artist,
      track: nowPlaying?.title,
      playing: playing && current != null,
      ts: Math.floor(Date.now() / 1000),
    }).catch(() => {});
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
            icon={<Archive size={15} />}
            title="Backup & Restore"
            onClick={() => setShowBackup(true)}
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
          {/* Version skew affects both lists, so it is stated above them rather than
              inside either tab. */}
          {skewWarning && (
            <p
              className="mx-3 mt-3 rounded-sm border border-warn/40 bg-surface px-2.5 py-1.5 text-[11px] text-warn"
              title={[...superseded.entries()]
                .map(([addr, target]) => `${addr}\n   duplicates ${target}`)
                .join("\n")}
            >
              {skewWarning}
            </p>
          )}
          {tab === "stations" ? (
            <section className="flex flex-col">
              <div className="flex items-center gap-2 px-3 pb-1 pt-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Stations
                </h2>
                <span className="font-mono text-[10px] text-muted/60">{source}</span>
                {stationMsg && (
                  <span className="font-mono text-[10px] text-accent">{stationMsg}</span>
                )}
                <button
                  type="button"
                  onClick={importStations}
                  title="Import stations from JSON"
                  className="ml-auto flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
                >
                  <Upload size={12} />
                  Import
                </button>
                <button
                  type="button"
                  onClick={exportStations}
                  disabled={stations.length === 0}
                  title="Export stations as JSON"
                  className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surfaceHover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
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
                onPublish={publishStationRow}
                onUnpublish={unpublishStation}
                signedIn={!!identity}
                icy={icyByUrl}
              />
            </section>
          ) : (
            <PodcastTab
              shows={relayShows}
              onPublished={refreshFollows}
              signedIn={!!identity}
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
          onPublished={refreshFollows}
          onClose={() => setShowAdd(false)}
          onAdded={onAdded}
        />
      )}
      {showBackup && (
        <BackupDialog
          stations={stations}
          onRestoreStations={restoreStations}
          onClose={() => setShowBackup(false)}
        />
      )}
    </div>
  );
}
