import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play, RefreshCw } from "lucide-react";
import { cn } from "../lib/cn";
import { podCache, refreshed } from "../lib/feedCache";
import { absorbPodcast, loadSubs, PODCASTS_EVENT, type Sub } from "../lib/podcasts";
import { describeOutcome, publishSequentially } from "../lib/publishAll";
import {
  getSetting,
  setSetting,
  HOME_LAST_LOOK_KEY,
  HOME_LEDGER_KEY,
  HOME_RANGE_KEY,
} from "../lib/settings";
import { cachedPodcasts, fetchPodcast, type Episode, type Podcast } from "../lib/tauri";
import {
  buildTimeline,
  groupByDay,
  isHomeRange,
  isNew,
  parseLedger,
  updateLedger,
  type Entry,
  type FeedIn,
  type HomeRange,
  type Ledger,
} from "../lib/timeline";

/** One episode waiting to play — see App's play-through queue. */
export interface QueueItem {
  ep: Episode;
  podcastTitle: string;
}

const RANGES: { id: HomeRange; label: string; title: string }[] = [
  { id: 1, label: "24h", title: "Episodes published in the last 24 hours" },
  { id: 7, label: "1 week", title: "Episodes published in the last week" },
  { id: 14, label: "2 weeks", title: "Episodes published in the last 2 weeks" },
];

const nowSecs = () => Math.floor(Date.now() / 1000);

function loadRange(): HomeRange {
  const v = Number(getSetting(HOME_RANGE_KEY));
  return isHomeRange(v) ? v : 7;
}

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}m`;
}

// "New since you last looked" is measured from the previous visit to Home. The
// visit's start is held at module level, and leaving is written on a deferred
// timer, so React's dev double-mount (mount → unmount → mount) reads as one
// visit instead of stamping "looked" before the list was ever seen.
let visitSince: number | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

function markLooked() {
  setSetting(HOME_LAST_LOOK_KEY, String(nowSecs()));
}

/** Home: what's new across every subscribed podcast, one line per episode,
 *  newest first, grouped by day. Reads the same feed cache as the Podcasts tab. */
export function HomeTab({
  onPlayEpisode,
  currentKey,
  playing,
}: {
  /** `then` plays after this episode ends; omitted, playback stops there. */
  onPlayEpisode: (ep: Episode, podcastTitle: string, then?: QueueItem[]) => void;
  currentKey: string | null;
  playing: boolean;
}) {
  const [subs, setSubs] = useState<Sub[]>(loadSubs);
  const [cache, setCache] = useState<Record<string, Podcast>>(() => ({ ...podCache }));
  const [range, setRange] = useState<HomeRange>(loadRange);
  const [now, setNow] = useState(nowSecs);
  const [since] = useState(() => {
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    if (visitSince === null) {
      const stored = Number(getSetting(HOME_LAST_LOOK_KEY));
      visitSince = stored > 0 ? stored : nowSecs();
    }
    return visitSince;
  });
  const ledgerRef = useRef<Ledger>(parseLedger(getSetting(HOME_LEDGER_KEY)));
  const [ledger, setLedger] = useState<Ledger>(ledgerRef.current);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const [rescanning, setRescanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Leaving Home (or closing the app) is "looked".
  useEffect(() => {
    window.addEventListener("beforeunload", markLooked);
    return () => {
      window.removeEventListener("beforeunload", markLooked);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        visitSince = null;
        markLooked();
      }, 0);
    };
  }, []);

  // Subscriptions change from the Podcasts tab, a backup restore, or the durable
  // store finishing its load after launch.
  useEffect(() => {
    const reload = () => setSubs(loadSubs());
    window.addEventListener(PODCASTS_EVENT, reload);
    return () => window.removeEventListener(PODCASTS_EVENT, reload);
  }, []);

  // Keep "Today" and the range edge honest in a window left open.
  useEffect(() => {
    const id = setInterval(() => setNow(nowSecs()), 60_000);
    return () => clearInterval(id);
  }, []);

  const put = (url: string, p: Podcast, absorb = true) => {
    podCache[url] = p;
    setCache((c) => ({ ...c, [url]: p }));
    if (absorb) absorbPodcast(url, p);
  };

  // Paint from disk, then refresh each feed not yet fetched this session — the
  // same sweep the Podcasts tab runs, sharing its `refreshed` set so a feed is
  // fetched once per launch whichever tab asks first.
  const urlKey = subs.map((s) => s.url).join("\n");
  useEffect(() => {
    let cancelled = false;
    const urls = urlKey ? urlKey.split("\n") : [];
    (async () => {
      const cold = urls.filter((u) => !podCache[u]);
      if (cold.length > 0) {
        try {
          const hits = await cachedPodcasts(cold);
          if (cancelled) return;
          for (const h of hits) put(h.url, h.podcast, !h.stale);
        } catch (e) {
          console.error("cached_podcasts failed", e);
        }
      }
      for (const url of urls) {
        if (cancelled) return;
        if (refreshed.has(url)) continue;
        try {
          const p = await fetchPodcast(url);
          if (cancelled) return;
          refreshed.add(url);
          put(url, p);
        } catch {
          /* a failing feed keeps its cached episodes; the Podcasts tab surfaces errors */
        }
      }
      if (!cancelled) setNow(nowSecs());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  const feeds: FeedIn[] = useMemo(
    () => subs.map((s) => ({ url: s.url, title: s.title, pod: cache[s.url] })),
    [subs, cache],
  );

  // Record first sightings as feeds land.
  useEffect(() => {
    const next = updateLedger(ledgerRef.current, feeds, nowSecs());
    if (next === ledgerRef.current) return;
    ledgerRef.current = next;
    setLedger(next);
    setSetting(HOME_LEDGER_KEY, JSON.stringify(next));
  }, [feeds]);

  const entries = useMemo(() => buildTimeline(feeds, now, range), [feeds, now, range]);
  const groups = useMemo(() => groupByDay(entries, now), [entries, now]);
  const fresh = (e: Entry) => isNew(ledger, e.feedUrl, e.ep.id, since);
  const newCount = groups.reduce(
    (n, g) =>
      n +
      g.rows.filter((r) => (r.kind === "one" ? fresh(r.entry) : r.entries.some(fresh))).length,
    0,
  );
  const showCount = new Set(entries.map((e) => e.feedUrl)).size;
  const loaded = feeds.filter((f) => f.pod).length;

  const chooseRange = (r: HomeRange) => {
    setRange(r);
    setSetting(HOME_RANGE_KEY, String(r));
  };

  const rescan = async () => {
    const urls = subs.map((s) => s.url);
    if (urls.length === 0 || rescanning) return;
    setRescanning(true);
    const outcome = await publishSequentially(
      urls,
      async (url) => {
        const p = await fetchPodcast(url);
        refreshed.add(url);
        put(url, p);
      },
      {
        delayMs: 0,
        onProgress: (done, total) =>
          setMsg(done < total ? `rescanning ${done + 1}/${total}…` : null),
      },
    );
    setRescanning(false);
    setNow(nowSecs());
    const m = describeOutcome(outcome, "rescanned");
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 4000);
  };

  const toggleFold = (key: string) =>
    setOpenFolds((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  /** `rest`: for a track inside an expanded batch, the tracks below it — they
   *  play on in list order and playback stops after the last. */
  const episodeRow = (e: Entry, nested = false, rest: Entry[] = []) => {
    const isCurrent = e.ep.id === currentKey;
    return (
      <li key={e.key}>
        <button
          type="button"
          onClick={() =>
            onPlayEpisode(
              e.ep,
              e.show,
              rest.map((x) => ({ ep: x.ep, podcastTitle: x.show })),
            )
          }
          title={
            nested && rest.length > 0
              ? `${e.ep.title} — then plays on through the ${rest.length} below`
              : `${e.show} — ${e.ep.title}`
          }
          className={cn(
            "flex w-full items-center gap-2 py-1.5 pr-3 text-left hover:bg-surfaceHover",
            nested ? "pl-[4.5rem]" : "pl-3",
            isCurrent && "bg-surface",
          )}
        >
          <span className="grid w-2 shrink-0 place-items-center" aria-hidden>
            {isCurrent && playing ? (
              <span className="h-2 w-2 rounded-full bg-ok" />
            ) : fresh(e) ? (
              <span className="h-1.5 w-1.5 rounded-full bg-warn" />
            ) : null}
          </span>
          {!nested && (
            <span className="w-10 shrink-0 font-mono text-[10px] text-muted/70">
              {fmtTime(e.at)}
            </span>
          )}
          {!nested && (
            <span className="w-40 shrink-0 truncate text-xs text-muted">{e.show}</span>
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              isCurrent && playing ? "text-ok" : "text-fg",
            )}
          >
            {e.ep.title}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted/70">
            {fmtDuration(e.ep.durationSecs)}
          </span>
          <Play size={11} className="shrink-0 text-muted/50" aria-hidden />
        </button>
      </li>
    );
  };

  return (
    <section className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 pb-1 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          What's new
        </h2>
        {newCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
            {newCount} new since you last looked
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {subs.length > 0 && (
            <span className="font-mono text-[10px] text-muted/70">
              {showCount} shows · {entries.length} episodes
              {loaded < subs.length && ` · ${loaded}/${subs.length} feeds read`}
            </span>
          )}
          <div className="flex items-center gap-0.5">
            {RANGES.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => chooseRange(o.id)}
                title={o.title}
                aria-pressed={range === o.id}
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[10px] transition-colors",
                  range === o.id
                    ? "bg-surface text-fg"
                    : "text-muted hover:bg-surfaceHover hover:text-fg",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {msg ? (
            <span className="font-mono text-[10px] text-accent">{msg}</span>
          ) : (
            subs.length > 0 && (
              <button
                type="button"
                onClick={() => void rescan()}
                disabled={rescanning}
                title="Re-read every subscribed feed now"
                className="flex items-center gap-1 rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
              >
                <RefreshCw size={11} />
                rescan
              </button>
            )
          )}
        </div>
      </div>

      {subs.length === 0 ? (
        <p className="px-3 py-6 text-xs text-muted">
          Subscribe to podcasts in the Podcasts tab, and their new episodes show up here.
        </p>
      ) : entries.length === 0 ? (
        <p className="px-3 py-6 text-xs text-muted">
          {loaded === 0
            ? "Reading feeds…"
            : `No episodes in the last ${range === 1 ? "24 hours" : range === 7 ? "week" : "2 weeks"}.`}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.day} className="flex flex-col">
            <h3 className="px-3 pb-1 pt-3 text-[10px] text-muted/70">{g.label}</h3>
            <ul className="flex flex-col">
              {g.rows.map((r) => {
                if (r.kind === "one") return episodeRow(r.entry);
                const key = `${g.day}\n${r.feedUrl}`;
                const open = openFolds.has(key);
                const total = r.entries.reduce((n, e) => n + (e.ep.durationSecs ?? 0), 0);
                const anyNew = r.entries.some(fresh);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => toggleFold(key)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2 py-1.5 pl-3 pr-3 text-left hover:bg-surfaceHover"
                    >
                      <span className="grid w-2 shrink-0 place-items-center" aria-hidden>
                        {anyNew && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}
                      </span>
                      <span className="w-10 shrink-0 font-mono text-[10px] text-muted/70">
                        {fmtTime(r.entries[0].at)}
                      </span>
                      <span className="w-40 shrink-0 truncate text-xs text-muted">{r.show}</span>
                      <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-muted">
                        {open ? (
                          <ChevronDown size={12} className="shrink-0" />
                        ) : (
                          <ChevronRight size={12} className="shrink-0" />
                        )}
                        <span className="truncate">
                          {r.entries.length} episodes ·{" "}
                          {r.entries
                            .slice(0, 3)
                            .map((e) => e.ep.title)
                            .join(", ")}
                          {r.entries.length > 3 && "…"}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted/70">
                        {fmtDuration(total)}
                      </span>
                      <span className="w-[11px] shrink-0" aria-hidden />
                    </button>
                    {open && (
                      <ul className="flex flex-col">
                        {r.entries.map((e, i) => episodeRow(e, true, r.entries.slice(i + 1)))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
