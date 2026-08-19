import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Plus,
  Rss,
  Upload,
  X,
} from "lucide-react";
import {
  cachedPodcasts,
  copyText,
  exportJson,
  fetchPodcast,
  openImportFile,
  publishShow,
  unfollowShow,
  type Episode,
  type Podcast,
} from "../lib/tauri";
import {
  mergeFollows,
  uniqueShowSlug,
  type FollowRow,
  type Show,
} from "../lib/show";
import {
  absorbPodcast,
  isPodcastSort,
  liveHarvest,
  podcastIdentity,
  latestEpisodeAt,
  loadSubs,
  mergeSubs,
  parseOpml,
  parseSubsJson,
  saveSubs,
  sortSubs,
  PODCASTS_EVENT,
  type PodcastSort,
  type Sub,
} from "../lib/podcasts";
import {
  getSetting,
  setSetting,
  SETTINGS_EVENT,
  PODCAST_SORT_KEY,
  PODCAST_VIEW_KEY,
} from "../lib/settings";
import { podcastIconKey } from "../lib/mediaIcon";
import { MediaGlyph } from "./MediaGlyph";
import { Modal } from "./Modal";
import { EnrichDialog } from "./EnrichDialog";
import { cn } from "../lib/cn";

type View = "list" | "cards";

function loadView(): View {
  return getSetting(PODCAST_VIEW_KEY) === "cards" ? "cards" : "list";
}

/** Ordering pref — defaults to `recent` so a freshly published feed surfaces
 *  without the user asking. */
function loadSort(): PodcastSort {
  const v = getSetting(PODCAST_SORT_KEY);
  return isPodcastSort(v) ? v : "recent";
}

const SORTS: { id: PodcastSort; label: string; title: string }[] = [
  { id: "recent", label: "Recent", title: "Newest episode first" },
  { id: "title", label: "A–Z", title: "By title" },
  { id: "added", label: "Added", title: "Newest subscription first" },
];

function fmtDuration(secs: number | null): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}m`;
}
function fmtDate(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

/** Episode rows for one podcast — shared by the list (indented under its row)
 *  and card (in the detail panel) views. */
function EpisodeList({
  pod,
  podcastTitle,
  currentKey,
  playing,
  onPlayEpisode,
  indent = false,
}: {
  pod: Podcast;
  podcastTitle: string;
  currentKey: string | null;
  playing: boolean;
  onPlayEpisode: (ep: Episode, podcastTitle: string) => void;
  indent?: boolean;
}) {
  if (pod.episodes.length === 0) {
    return (
      <p className={cn("py-2 text-xs text-muted", indent ? "px-9" : "px-3")}>
        No audio episodes found in this feed.
      </p>
    );
  }
  return (
    <ul className="flex flex-col pb-1">
      {pod.episodes.slice(0, 100).map((ep) => {
        const isCurrent = ep.id === currentKey;
        return (
          <li key={ep.id}>
            <button
              type="button"
              onClick={() => onPlayEpisode(ep, podcastTitle)}
              className={cn(
                "flex w-full items-center gap-2 py-1.5 pr-3 text-left hover:bg-surfaceHover",
                indent ? "pl-9" : "pl-3",
                isCurrent && "bg-surface",
              )}
            >
              {/* Now-playing cue mirrors Stations: a green "live" dot for the
                  playing episode; a muted play triangle for the rest. */}
              {isCurrent && playing ? (
                <span className="grid w-3 shrink-0 place-items-center" aria-hidden>
                  <span className="h-2 w-2 rounded-full bg-ok" />
                </span>
              ) : (
                <Play size={12} className="shrink-0 text-muted" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  isCurrent && playing
                    ? "text-ok"
                    : isCurrent
                      ? "text-fg"
                      : "text-muted",
                )}
              >
                {ep.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted/70">
                {[fmtDate(ep.publishedAt), fmtDuration(ep.durationSecs)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Harvested Tier-A identity: author byline + category / website / email chips.
 *  Feed-authoritative (2026-08-06 harvest). Shared by both expand views so they
 *  can't drift — `indent` aligns it under a list row; unindented it sits in the
 *  card-detail header band. Website/email are static chips for now (no link-out
 *  yet). Renders nothing when the feed carries none of these fields. */
function IdentityRow({
  row,
  pod,
  indent = false,
  onEdit,
}: {
  /** The stored subscription — the source of truth when nothing is fetched. */
  row: Sub;
  /** This session's fetched feed, when there is one. Outranks the stored slice. */
  pod?: Podcast;
  indent?: boolean;
  onEdit?: () => void;
}) {
  // Read through the merge, not off the fetched feed: the stored harvest is what
  // makes identity survive a restart (U4.5's "no re-fetch needed to re-render"),
  // and the feed-cache cannot stand in for it — it is pruned on unsubscribe and
  // invalidated whenever the parser changes. `fromUser` marks values the user
  // supplied where the feed said nothing.
  const id = podcastIdentity(row, pod ? liveHarvest(pod) : undefined);
  const saysNothing =
    !id.author && !id.categories?.length && !id.website && !id.ownerEmail;
  // A show that states nothing is exactly the one worth filling in by hand, so the
  // way in cannot be hidden behind having something to show already.
  if (saysNothing && !onEdit) return null;
  // Every chip caps at the row width and truncates with an ellipsis; the full
  // value is on the title tooltip (hover) until fields get real link-outs — so no
  // long copyright / URL / sentence can blow out the layout.
  const chip =
    "max-w-full truncate rounded-sm bg-surface px-1.5 py-0.5 text-[10px] text-muted";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1",
        indent ? "px-9 pb-1.5 pt-0.5" : "border-b border-surface px-3 py-2",
      )}
    >
      {id.author && (
        <span
          className="max-w-full truncate text-xs text-muted"
          title={
            id.fromUser.includes("author") ? `${id.author} (your note)` : id.author
          }
        >
          {id.author}
        </span>
      )}
      {(id.categories ?? []).map((c) => (
        <span key={c} className={chip} title={c}>
          {c}
        </span>
      ))}
      {id.website && (
        <span className={chip} title={id.website}>
          {id.website.replace(/^https?:\/\//, "").replace(/\/+$/, "")}
        </span>
      )}
      {id.ownerEmail && (
        <span className={chip} title={id.ownerEmail}>
          {id.ownerEmail}
        </span>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Fill in what this feed leaves out"
          className="ml-auto shrink-0 rounded-sm border border-surface px-1.5 py-0.5 text-[9px] text-muted transition-colors hover:border-accent hover:text-accent"
        >
          {saysNothing ? "fill in" : "edit"}
        </button>
      )}
    </div>
  );
}

/** The Follow / Following control for one row.
 *
 *  Published state is not local state: the chip reflects a `show.v1` read back off
 *  the relays, so it lights up when the event lands, not when the click happens.
 *  Hidden entirely without a signing key — there is nothing to publish with, and a
 *  dead button explains less than no button.
 *
 *  Distinct from the `nostr` chip on these rows: that one means the feed is *served
 *  from* an npub (a castr.me-style bridge); this means the follow is *published to*
 *  the relays. Both are Nostr, neither implies the other. */
function FollowControl({
  row,
  signedIn,
  busy,
  onFollow,
  onUnfollow,
  compact = false,
}: {
  row: FollowRow;
  signedIn: boolean;
  busy: boolean;
  onFollow: (row: FollowRow) => void;
  onUnfollow: (row: FollowRow) => void;
  compact?: boolean;
}) {
  if (!signedIn) return null;
  // `following` is a TOGGLE, not a badge. It used to be a label, which left ✕ as
  // the only way to retract a follow — and ✕ also removes the subscription, so
  // "stop publishing this" and "remove it from my list" could not be done
  // separately. One is a public act, the other is local housekeeping.
  const published = !!row.show;
  return (
    <button
      type="button"
      onClick={() => (published ? onUnfollow(row) : onFollow(row))}
      disabled={busy}
      title={
        published
          ? `Published as show.v1 — airplay:show:${row.show!.slug}\nClick to unfollow (publishes a kind:5). Your subscription stays.`
          : "Publish a show.v1 follow to the relays"
      }
      className={cn(
        "shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] transition-colors disabled:opacity-40",
        published
          ? "bg-surface font-mono text-nostr hover:text-alert"
          : "border border-surface text-muted hover:border-nostr hover:text-nostr",
        compact && "px-1",
      )}
    >
      {busy ? "…" : published ? "following" : "follow"}
    </button>
  );
}

/** Feed bodies for this session, shared across mounts so switching tabs doesn't
 *  refetch. Primed on first mount from the on-disk cache (Rust `feed-cache/`), so
 *  the list paints from the last known state instead of a blank slate while every
 *  feed refetches. */
const podCache: Record<string, Podcast> = {};

/** Feeds already refreshed from the network this session. The prefetch loop skips
 *  these rather than everything in `podCache` — otherwise a disk-primed entry
 *  would look fetched and the list would never see today's episodes. */
const refreshed = new Set<string>();

/** Podcasts tab (U4): subscribe by RSS URL (localStorage), browse episodes
 *  fetched via Rust feed-rs, play through the shared player. Two views — a dense
 *  list and a glyph card grid (icons matched by title, see lib/mediaIcon). */
export function PodcastTab({
  onPlayEpisode,
  currentKey,
  playing,
  shows,
  onPublished,
  signedIn,
}: {
  onPlayEpisode: (ep: Episode, podcastTitle: string) => void;
  currentKey: string | null;
  playing: boolean;
  /** The user's published `show.v1` follows, read off the relays (useFollows). */
  shows: Show[];
  /** Re-read the published follows (useFollows().refresh). Called after a publish
   *  or an unfollow: the open subscription does not reliably hand back an event
   *  published mid-session, so the row is marked by re-asking the relays rather
   *  than by trusting the click. */
  onPublished?: () => void;
  /** A signing key is loaded — without one there is nothing to publish with. */
  signedIn: boolean;
}) {
  const [subs, setSubs] = useState<Sub[]>(loadSubs);
  const [view, setView] = useState<View>(loadView);
  const [sort, setSort] = useState<PodcastSort>(loadSort);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Podcast>>(() => ({
    ...podCache,
  }));
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  // Feed URL just copied to the clipboard — briefly shows a ✓ on that row.
  const [copied, setCopied] = useState<string | null>(null);
  // Feed the user clicked ✕ on — unsubscribing waits on the confirm dialog. The
  // ✕ sits under the pointer on a hover-revealed row, so a stray click used to
  // drop a subscription outright with no undo.
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const unfollowCancelRef = useRef<HTMLButtonElement>(null);
  // Feed URL currently being published / retracted — disables just that row's control.
  const [publishing, setPublishing] = useState<string | null>(null);
  // Feed whose "fill in" editor is open.
  const [editing, setEditing] = useState<string | null>(null);
  // Feed whose follow is about to be retracted. Following is one click (additive,
  // and undone by clicking again); UNfollowing publishes a deletion to every relay,
  // so it asks first — the same line the app draws between adding and removing.
  const [confirmUnfollow, setConfirmUnfollow] = useState<string | null>(null);

  // Re-sync when a restore (the app-level Backup dialog) writes subs from
  // outside this tab — same-document localStorage writes don't fire `storage`.
  useEffect(() => {
    const onChange = () => setSubs(loadSubs());
    window.addEventListener(PODCASTS_EVENT, onChange);
    return () => window.removeEventListener(PODCASTS_EVENT, onChange);
  }, []);

  // Re-read the view + sort prefs once the durable settings store finishes loading.
  useEffect(() => {
    const onSettings = () => {
      setView(loadView());
      setSort(loadSort());
    };
    window.addEventListener(SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings);
  }, []);

  const chooseView = (v: View) => {
    setView(v);
    setSetting(PODCAST_VIEW_KEY, v);
  };

  // Land focus on Cancel, not on the destructive button — a stray Enter or
  // Space right after the mis-click then dismisses rather than confirms.
  useEffect(() => {
    if (confirmUrl) cancelRef.current?.focus();
  }, [confirmUrl]);
  useEffect(() => {
    if (confirmUnfollow) unfollowCancelRef.current?.focus();
  }, [confirmUnfollow]);

  const chooseSort = (v: PodcastSort) => {
    setSort(v);
    setSetting(PODCAST_SORT_KEY, v);
  };

  const copy = (url: string) => {
    copyText(url)
      .then(() => {
        setCopied(url);
        setTimeout(() => setCopied((c) => (c === url ? null : c)), 1200);
      })
      .catch((e) => console.error("copy failed", e));
  };

  const exportSubs = () => {
    exportJson("ntune-podcasts.json", subs).catch((e) =>
      console.error("export podcasts failed", e),
    );
  };

  // Import subscriptions from OPML (feed-reader export) or the app's JSON shape —
  // auto-detected by content (leading '<' => OPML) with the extension as a
  // fallback. Feeds are flattened, deduped by url, merged (imported first), and
  // fetched lazily on expand as usual.
  const importSubs = async () => {
    setError(null);
    try {
      const file = await openImportFile();
      if (file == null) return; // cancelled
      const looksXml =
        /^\s*</.test(file.text) || /\.(opml|xml)$/i.test(file.path);
      const parsed = looksXml
        ? parseOpml(file.text)
        : parseSubsJson(JSON.parse(file.text));
      if (parsed.length === 0) throw new Error("no feeds found in file");
      setSubs((prev) => {
        const next = mergeSubs(prev, parsed);
        saveSubs(next);
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  };

  // Write the session cache, React state, AND the durable store. The store write
  // lives in lib/podcasts.ts and does not care whether this component is mounted —
  // it used to be an effect here, which lost every fetch that resolved after the
  // tab was closed (macOS 2026-08-19).
  const putCache = (url: string, p: Podcast, absorb = true) => {
    podCache[url] = p;
    setCache((c) => ({ ...c, [url]: p }));
    // `absorb` is false for a body primed from a STALE cache entry: showing it is
    // right (it is the last thing we knew), writing it to the store is not.
    if (absorb) absorbPodcast(url, p);
  };

  // Local subscriptions merged with the follows published to the relays. A show
  // followed on another machine appears here even though this device never
  // subscribed to it — that is the whole point of publishing them.
  const rows = useMemo(() => mergeFollows(subs, shows), [subs, shows]);

  // Prefetch every subscription's feed in the background so card/list metadata
  // (language, copyright, identity, newest-episode date) shows without expanding.
  // Skips anything already in the session cache; errors are swallowed here
  // (expanding a feed re-fetches via fetchInto and surfaces them).
  //
  // Keyed on the URL SET, not on `subs` identity: the latestAt reconcile below
  // rewrites `subs` after every fetch, and a dep on the array would cancel and
  // restart this loop each time — re-fetching whichever feed was in flight.
  const subUrlKey = rows.map((s) => s.url).join("\n");
  useEffect(() => {
    let cancelled = false;
    const urls = subUrlKey ? subUrlKey.split("\n") : [];
    (async () => {
      // Paint from disk first — one local read for the whole list, so episodes
      // and identity are on screen before the network is touched.
      const cold = urls.filter((u) => !podCache[u]);
      if (cold.length > 0) {
        try {
          const hits = await cachedPodcasts(cold);
          if (cancelled) return;
          for (const h of hits) putCache(h.url, h.podcast, !h.stale);
        } catch (e) {
          console.error("cached_podcasts failed", e);
        }
      }
      // Then refresh each feed in the background. Conditional GET makes an
      // unchanged feed a cheap 304, and the disk-primed rows just get restated.
      for (const url of urls) {
        if (cancelled) return;
        if (refreshed.has(url)) continue;
        try {
          const p = await fetchPodcast(url);
          if (cancelled) return;
          refreshed.add(url);
          putCache(url, p);
        } catch {
          /* ignore prefetch errors */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subUrlKey]);

  // Display order. Falls back to the persisted stamp for feeds not fetched yet;
  // `sortSubs` is stable, so unknown-date feeds hold their stored order.
  const ordered = useMemo(
    () =>
      sortSubs(rows, sort, (s) => latestEpisodeAt(cache[s.url]) ?? s.latestAt ?? null) as FollowRow[],
    [rows, sort, cache],
  );

  const fetchInto = async (url: string) => {
    setLoadingUrl(url);
    setError(null);
    try {
      const p = await fetchPodcast(url);
      refreshed.add(url);
      putCache(url, p);
      return p;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoadingUrl(null);
    }
  };

  const add = async () => {
    const url = addUrl.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      const p = await fetchPodcast(url);
      refreshed.add(url);
      putCache(url, p);
      setSubs((prev) => {
        const next = [{ url, title: p.title }, ...prev.filter((s) => s.url !== url)];
        saveSubs(next);
        return next;
      });
      setAddUrl("");
      setExpanded(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = (url: string) => {
    // Local only. Retracting the published follow is the `following` toggle's job —
    // conflating them meant you could not stop publishing a show without also
    // dropping it from your list, or tidy your list without telling the relays.
    setSubs((prev) => {
      const next = prev.filter((s) => s.url !== url);
      saveSubs(next);
      return next;
    });
    if (expanded === url) setExpanded(null);
    setConfirmUrl(null);
  };

  // Follow = publish a `show.v1`. Deliberately per-show and never automatic: a
  // station is added one at a time, but podcasts arrive in bulk from OPML, and
  // auto-publishing an import would fire dozens of events at once (at hosts already
  // seen rate-limiting a mere read sweep). Adding a subscription stays local.
  const follow = async (row: FollowRow) => {
    setPublishing(row.url);
    setError(null);
    try {
      const taken = rows.map((r) => r.show?.slug).filter((v): v is string => !!v);
      const slug = uniqueShowSlug(row.title, taken);
      await publishShow(slug, row.title, row.url, { guid: row.guid });
      // Published state is still never local state — but the open subscription
      // cannot be relied on to hand the event back (macOS 2026-08-19: the chip
      // stayed `follow` until restart), so re-read the relays and let
      // mergeFollows mark the row from what they actually serve.
      onPublished?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(null);
    }
  };

  const unfollow = async (row: FollowRow) => {
    if (!row.show) return;
    setConfirmUnfollow(null);
    setPublishing(row.url);
    try {
      await unfollowShow(row.show.slug, row.show.eventId);
      onPublished?.(); // same reason as follow(): re-read rather than assume
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(null);
    }
  };

  const toggle = (url: string) => {
    if (expanded === url) {
      setExpanded(null);
      return;
    }
    setExpanded(url);
    if (!cache[url]) void fetchInto(url);
  };

  const field =
    "flex-1 rounded-sm border border-surface bg-surface px-2.5 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent";

  const expandedSub = expanded ? rows.find((s) => s.url === expanded) : undefined;
  const confirmSub = confirmUrl ? rows.find((s) => s.url === confirmUrl) : undefined;
  const editingRow = editing ? rows.find((s) => s.url === editing) : undefined;
  const unfollowRow = confirmUnfollow
    ? rows.find((s) => s.url === confirmUnfollow)
    : undefined;

  return (
    <div className="flex flex-col">
      {/* Subscribe row */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Rss size={14} className="shrink-0 text-accent" />
        <input
          className={field}
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Podcast RSS feed URL…"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={add}
          disabled={adding || !addUrl.trim()}
          className="flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1.5 text-xs font-medium text-bg disabled:opacity-40"
        >
          {adding ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          Add
        </button>
        <button
          type="button"
          onClick={importSubs}
          title="Import podcasts (OPML or JSON)"
          className="flex items-center gap-1 rounded-sm border border-surface px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
        >
          <Upload size={13} />
        </button>
        <button
          type="button"
          onClick={exportSubs}
          disabled={subs.length === 0}
          title="Export podcasts as JSON"
          className="flex items-center gap-1 rounded-sm border border-surface px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        >
          <Download size={13} />
        </button>
      </div>
      {error && <p className="px-3 pb-2 text-xs text-alert">{error}</p>}

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted">
          No podcasts yet. Paste an RSS feed URL above to subscribe.
        </div>
      ) : (
        <>
          {/* Count + sort + list/card view toggle */}
          <div className="flex items-center gap-2 px-3 pb-1">
            <span className="font-mono text-[10px] text-muted/60">
              {subs.length} subscribed
              {rows.some((r) => r.show) &&
                ` · ${rows.filter((r) => r.show).length} published`}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              {SORTS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => chooseSort(o.id)}
                  title={o.title}
                  aria-pressed={sort === o.id}
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-[10px] transition-colors",
                    sort === o.id
                      ? "bg-surface text-fg"
                      : "text-muted hover:bg-surfaceHover hover:text-fg",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5">
              {(
                [
                  { id: "list", icon: <List size={13} />, label: "List view" },
                  { id: "cards", icon: <LayoutGrid size={13} />, label: "Card view" },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => chooseView(v.id)}
                  title={v.label}
                  aria-label={v.label}
                  aria-pressed={view === v.id}
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-sm transition-colors",
                    view === v.id
                      ? "bg-surface text-fg"
                      : "text-muted hover:bg-surfaceHover hover:text-fg",
                  )}
                >
                  {v.icon}
                </button>
              ))}
            </div>
          </div>

          {view === "list" ? (
            <ul className="flex flex-col">
              {ordered.map((s) => {
                const open = expanded === s.url;
                const pod = cache[s.url];
                return (
                  <li key={s.url} className="border-b border-surface/50">
                    <div className="group flex items-stretch">
                      <button
                        type="button"
                        onClick={() => toggle(s.url)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-surfaceHover"
                      >
                        {open ? (
                          <ChevronDown size={14} className="shrink-0 text-muted" />
                        ) : (
                          <ChevronRight size={14} className="shrink-0 text-muted" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">
                          {s.title}
                        </span>
                        {s.npub && (
                          <span
                            className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[9px] text-nostr"
                            title={`Nostr npub feed — ${s.npub}\n(RSS bridge today; native 1063 reading planned)`}
                          >
                            nostr
                          </span>
                        )}
                        {s.relayOnly && (
                          <span
                            className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 text-[9px] text-muted"
                            title="Followed on the relays, not subscribed on this device."
                          >
                            relay
                          </span>
                        )}
                        {loadingUrl === s.url && (
                          <Loader2 size={12} className="animate-spin text-muted" />
                        )}
                        {/* Harvested language + copyright, read through the merge:
                            the STORED slice answers before anything is fetched, so
                            these survive a restart instead of waiting on a refetch. */}
                        {(() => {
                          const id = podcastIdentity(s, pod ? liveHarvest(pod) : undefined);
                          if (!id.language && !id.copyright) return null;
                          return (
                            <span className="flex shrink-0 items-center gap-2 pl-2 text-[10px] text-muted/60">
                              {id.copyright && (
                                <span
                                  className="max-w-[16rem] truncate text-muted/85"
                                  title={id.copyright}
                                >
                                  {id.copyright}
                                </span>
                              )}
                              {id.language && (
                                <span className="font-mono uppercase text-fg/80">
                                  {id.language}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </button>
                      {/* Sibling of the row button, never a child: a <button>
                          inside a <button> is invalid HTML and React refuses to
                          hydrate it. */}
                      <div className="flex shrink-0 items-center pr-1">
                        <FollowControl
                          row={s}
                          signedIn={signedIn}
                          busy={publishing === s.url}
                          onFollow={follow}
                          onUnfollow={(r) => setConfirmUnfollow(r.url)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => copy(s.url)}
                        title="Copy feed URL"
                        aria-label={`Copy ${s.title} feed URL`}
                        className={cn(
                          "grid w-8 shrink-0 place-items-center text-muted transition-opacity hover:text-fg",
                          copied === s.url
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        {copied === s.url ? (
                          <Check size={14} className="text-ok" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      {/* Nothing local to remove on a relay-only row: that one is
                          a published follow, and `following` is how it goes. */}
                      {!s.relayOnly && (
                        <button
                          type="button"
                          onClick={() => setConfirmUrl(s.url)}
                          title="Remove from my list"
                          aria-label={`Unsubscribe ${s.title}`}
                          className="grid w-8 shrink-0 place-items-center text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {open && (
                      <>
                        {/* Identity comes from the STORE, so expanding a row says
                            something even with no feed fetched — after a restore, or
                            offline. Gating this on `pod` made the persisted slice
                            invisible exactly when it is the only thing left. */}
                        <IdentityRow
                          row={s}
                          pod={pod}
                          indent
                          onEdit={() => setEditing(s.url)}
                        />
                        {pod ? (
                          <EpisodeList
                            pod={pod}
                            podcastTitle={s.title}
                            currentKey={currentKey}
                            playing={playing}
                            onPlayEpisode={onPlayEpisode}
                            indent
                          />
                        ) : (
                          <p className="px-9 py-2 text-xs text-muted">
                            {loadingUrl === s.url
                              ? "Fetching episodes…"
                              : "No episodes cached — they load when the feed is fetched."}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-3 pb-3">
              <div className="overflow-x-auto pb-1">
              <div className="flex items-stretch gap-2">
                {ordered.map((s) => {
                  const open = expanded === s.url;
                  const pod = cache[s.url];
                  return (
                    <div
                      key={s.url}
                      className="group relative shrink-0 min-w-[136px] basis-[calc((100%_-_4.5rem)/10)]"
                    >
                      <button
                        type="button"
                        onClick={() => toggle(s.url)}
                        title={s.title}
                        aria-pressed={open}
                        className={cn(
                          "flex h-full w-full flex-col items-center gap-2 rounded-sm border p-3 text-center transition-colors",
                          open
                            ? "border-accent bg-surface"
                            : "border-surface hover:bg-surfaceHover",
                        )}
                      >
                        <MediaGlyph iconKey={podcastIconKey(s.title)} size={48} />
                        <span className="line-clamp-2 text-xs leading-snug text-fg">
                          {s.title}
                        </span>
                        {s.npub && (
                          <span
                            className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[9px] text-nostr"
                            title={`Nostr npub feed — ${s.npub}\n(RSS bridge today; native 1063 reading planned)`}
                          >
                            nostr
                          </span>
                        )}

                        {loadingUrl === s.url && (
                          <Loader2 size={12} className="animate-spin text-muted" />
                        )}
                        {/* Harvested language + copyright, each centered on its
                            own line — populates once the feed is fetched (on
                            expand); copyright truncated, full value on hover. */}
                        {(() => {
                          const id = podcastIdentity(s, pod ? liveHarvest(pod) : undefined);
                          return (
                            <>
                              {id.language && (
                                <span className="font-mono text-[10px] uppercase text-fg/80">
                                  {id.language}
                                </span>
                              )}
                              {id.copyright && (
                                <span
                                  className="line-clamp-1 max-w-full text-[9px] leading-tight text-muted/85"
                                  title={id.copyright}
                                >
                                  {id.copyright}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </button>
                      {/* Outside the card button — nested buttons are invalid. */}
                      <div className="absolute left-1 top-1">
                        <FollowControl
                          row={s}
                          signedIn={signedIn}
                          busy={publishing === s.url}
                          onFollow={follow}
                          onUnfollow={(r) => setConfirmUnfollow(r.url)}
                          compact
                        />
                      </div>
                      {!s.relayOnly && (
                        <button
                          type="button"
                          onClick={() => setConfirmUrl(s.url)}
                          title="Remove from my list"
                          aria-label={`Unsubscribe ${s.title}`}
                          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-sm bg-panel/80 text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>

              {/* Detail panel for the selected card */}
              {expandedSub && (
                <div className="mt-3 rounded-sm border border-surface">
                  <div className="flex items-center gap-2 border-b border-surface px-3 py-2">
                    <MediaGlyph iconKey={podcastIconKey(expandedSub.title)} size={22} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {expandedSub.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => copy(expandedSub.url)}
                      title="Copy feed URL"
                      aria-label={`Copy ${expandedSub.title} feed URL`}
                      className="grid h-6 w-6 place-items-center text-muted hover:text-fg"
                    >
                      {copied === expandedSub.url ? (
                        <Check size={14} className="text-ok" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  <IdentityRow
                    row={expandedSub}
                    pod={cache[expandedSub.url]}
                    onEdit={() => setEditing(expandedSub.url)}
                  />
                  {cache[expandedSub.url] ? (
                    <EpisodeList
                      pod={cache[expandedSub.url]}
                      podcastTitle={expandedSub.title}
                      currentKey={currentKey}
                      playing={playing}
                      onPlayEpisode={onPlayEpisode}
                    />
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted">
                      {loadingUrl === expandedSub.url
                        ? "Fetching episodes…"
                        : "No episodes cached — they load when the feed is fetched."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editingRow && (
        <EnrichDialog
          sub={editingRow}
          feed={{
            ...(editingRow.harvest ?? {}),
            ...(cache[editingRow.url] ? liveHarvest(cache[editingRow.url]) : {}),
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {unfollowRow?.show && (
        <Modal title="Unfollow?" onClose={() => setConfirmUnfollow(null)}>
          <p className="text-sm text-fg">
            Stop publishing <span className="font-medium">{unfollowRow.title}</span>{" "}
            as a show you follow?
          </p>
          <p className="mt-1.5 break-all font-mono text-[10px] text-muted">
            airplay:show:{unfollowRow.show.slug}
          </p>
          <p className="mt-2 text-xs text-muted">
            {unfollowRow.relayOnly
              ? "A Nostr unfollow (kind:5) is published to your relays and the row goes — this show is followed but not subscribed on this device. You can follow it again at any time."
              : "A Nostr unfollow (kind:5) is published to your relays. Your subscription and its episodes stay exactly as they are; only the public follow goes."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              ref={unfollowCancelRef}
              onClick={() => setConfirmUnfollow(null)}
              className="rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void unfollow(unfollowRow)}
              className="rounded-sm bg-alert px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
            >
              Unfollow
            </button>
          </div>
        </Modal>
      )}

      {/* Unsubscribing is confirmed — the hover-✕ sits right where the pointer
          already is, and there's no undo once the sub is gone. */}
      {confirmSub && (
        <Modal title="Unsubscribe?" onClose={() => setConfirmUrl(null)}>
          <p className="text-sm text-fg">
            Remove <span className="font-medium">{confirmSub.title}</span> from
            your podcasts?
          </p>
          <p className="mt-1.5 break-all font-mono text-[10px] text-muted">
            {confirmSub.url}
          </p>
          <p className="mt-2 text-xs text-muted">
            {confirmSub.show
              ? "Only the subscription goes. You still publish this show as a follow, so it stays in the list marked “relay” until you turn “following” off — nothing is sent to the relays by removing it here."
              : "Only the subscription goes — nothing is deleted from the feed or from disk, and you can add the URL back at any time."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              ref={cancelRef}
              onClick={() => setConfirmUrl(null)}
              className="rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => remove(confirmSub.url)}
              className="rounded-sm bg-alert px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
            >
              Unsubscribe
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
