import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  LayoutGrid,
  List,
  Loader2,
  Music,
  Play,
  Plus,
  Rss,
  Upload,
  X,
} from "lucide-react";
import {
  copyText,
  exportJson,
  fetchPodcast,
  importJson,
  type Episode,
  type Podcast,
} from "../lib/tauri";
import { podcastIconKey } from "../lib/mediaIcon";
import { MediaGlyph } from "./MediaGlyph";
import { cn } from "../lib/cn";

interface Sub {
  url: string;
  title: string;
}

const SUBS_KEY = "ntune.podcasts";
const VIEW_KEY = "ntune.podcastView";

type View = "list" | "cards";

function loadSubs(): Sub[] {
  try {
    return JSON.parse(localStorage.getItem(SUBS_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveSubs(s: Sub[]) {
  localStorage.setItem(SUBS_KEY, JSON.stringify(s));
}

function loadView(): View {
  return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "list";
}

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
              {isCurrent && playing ? (
                <Music size={12} className="shrink-0 text-mauve" />
              ) : (
                <Play size={12} className="shrink-0 text-muted" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  isCurrent ? "text-fg" : "text-muted",
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
function IdentityRow({ pod, indent = false }: { pod: Podcast; indent?: boolean }) {
  if (
    !pod.author &&
    pod.categories.length === 0 &&
    !pod.website &&
    !pod.ownerEmail
  )
    return null;
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
      {pod.author && (
        <span
          className="max-w-full truncate text-xs text-muted"
          title={pod.author}
        >
          {pod.author}
        </span>
      )}
      {pod.categories.map((c) => (
        <span key={c} className={chip} title={c}>
          {c}
        </span>
      ))}
      {pod.website && (
        <span className={chip} title={pod.website}>
          {pod.website.replace(/^https?:\/\//, "").replace(/\/+$/, "")}
        </span>
      )}
      {pod.ownerEmail && (
        <span className={chip} title={pod.ownerEmail}>
          {pod.ownerEmail}
        </span>
      )}
    </div>
  );
}

/** Podcasts tab (U4): subscribe by RSS URL (localStorage), browse episodes
 *  fetched via Rust feed-rs, play through the shared player. Two views — a dense
 *  list and a glyph card grid (icons matched by title, see lib/mediaIcon). */
export function PodcastTab({
  onPlayEpisode,
  currentKey,
  playing,
}: {
  onPlayEpisode: (ep: Episode, podcastTitle: string) => void;
  currentKey: string | null;
  playing: boolean;
}) {
  const [subs, setSubs] = useState<Sub[]>(loadSubs);
  const [view, setView] = useState<View>(loadView);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Podcast>>({});
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  // Feed URL just copied to the clipboard — briefly shows a ✓ on that row.
  const [copied, setCopied] = useState<string | null>(null);

  const chooseView = (v: View) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
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

  // Import subscriptions from a JSON file and merge into the list (deduped by
  // url, imported first). Accepts our export shape [{url,title}]; a missing
  // title falls back to the url. Feeds are fetched lazily on expand as usual.
  const importSubs = async () => {
    setError(null);
    try {
      const data = await importJson<unknown>();
      if (data == null) return; // cancelled
      if (!Array.isArray(data)) throw new Error("expected a JSON array");
      const incoming: Sub[] = data
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => {
          const url = String(r.url ?? "").trim();
          return { url, title: String(r.title ?? "").trim() || url };
        })
        .filter((s) => s.url);
      if (incoming.length === 0) throw new Error("no valid podcasts in file");
      setSubs((prev) => {
        const urls = new Set(incoming.map((s) => s.url));
        const next = [...incoming, ...prev.filter((s) => !urls.has(s.url))];
        saveSubs(next);
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const fetchInto = async (url: string) => {
    setLoadingUrl(url);
    setError(null);
    try {
      const p = await fetchPodcast(url);
      setCache((c) => ({ ...c, [url]: p }));
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
      setCache((c) => ({ ...c, [url]: p }));
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
    setSubs((prev) => {
      const next = prev.filter((s) => s.url !== url);
      saveSubs(next);
      return next;
    });
    if (expanded === url) setExpanded(null);
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

  const expandedSub = expanded ? subs.find((s) => s.url === expanded) : undefined;

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
          title="Import podcasts from JSON"
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

      {subs.length === 0 ? (
        <div className="p-4 text-sm text-muted">
          No podcasts yet. Paste an RSS feed URL above to subscribe.
        </div>
      ) : (
        <>
          {/* Count + list/card view toggle */}
          <div className="flex items-center gap-2 px-3 pb-1">
            <span className="font-mono text-[10px] text-muted/60">
              {subs.length} subscribed
            </span>
            <div className="ml-auto flex items-center gap-0.5">
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
              {subs.map((s) => {
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
                        {loadingUrl === s.url && (
                          <Loader2 size={12} className="animate-spin text-muted" />
                        )}
                        {/* Harvested language + copyright — the row has the width
                            for it; populates once the feed is fetched (on expand). */}
                        {pod && (pod.language || pod.copyright) && (
                          <span className="flex shrink-0 items-center gap-2 pl-2 text-[10px] text-muted/60">
                            {pod.copyright && (
                              <span
                                className="max-w-[16rem] truncate text-muted/85"
                                title={pod.copyright}
                              >
                                {pod.copyright}
                              </span>
                            )}
                            {pod.language && (
                              <span className="font-mono uppercase text-fg/80">
                                {pod.language}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
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
                      <button
                        type="button"
                        onClick={() => remove(s.url)}
                        title="Unsubscribe"
                        aria-label={`Unsubscribe ${s.title}`}
                        className="grid w-8 shrink-0 place-items-center text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {open && pod && (
                      <>
                        <IdentityRow pod={pod} indent />
                        <EpisodeList
                          pod={pod}
                          podcastTitle={s.title}
                          currentKey={currentKey}
                          playing={playing}
                          onPlayEpisode={onPlayEpisode}
                          indent
                        />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-3 pb-3">
              <div className="overflow-x-auto">
              <div className="grid grid-cols-10 gap-2 min-w-[1120px]">
                {subs.map((s) => {
                  const open = expanded === s.url;
                  const pod = cache[s.url];
                  return (
                    <div key={s.url} className="group relative">
                      <button
                        type="button"
                        onClick={() => toggle(s.url)}
                        title={s.title}
                        aria-pressed={open}
                        className={cn(
                          "flex w-full flex-col items-center gap-2 rounded-sm border p-3 text-center transition-colors",
                          open
                            ? "border-accent bg-surface"
                            : "border-surface hover:bg-surfaceHover",
                        )}
                      >
                        <MediaGlyph iconKey={podcastIconKey(s.title)} size={48} />
                        <span className="line-clamp-2 text-xs leading-snug text-fg">
                          {s.title}
                        </span>
                        {loadingUrl === s.url && (
                          <Loader2 size={12} className="animate-spin text-muted" />
                        )}
                        {/* Harvested language + copyright, each centered on its
                            own line — populates once the feed is fetched (on
                            expand); copyright truncated, full value on hover. */}
                        {pod?.language && (
                          <span className="font-mono text-[10px] uppercase text-fg/80">
                            {pod.language}
                          </span>
                        )}
                        {pod?.copyright && (
                          <span
                            className="line-clamp-1 max-w-full text-[9px] leading-tight text-muted/85"
                            title={pod.copyright}
                          >
                            {pod.copyright}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s.url)}
                        title="Unsubscribe"
                        aria-label={`Unsubscribe ${s.title}`}
                        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-sm bg-panel/80 text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
              </div>

              {/* Detail panel for the selected card */}
              {expandedSub && cache[expandedSub.url] && (
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
                  <IdentityRow pod={cache[expandedSub.url]} />
                  <EpisodeList
                    pod={cache[expandedSub.url]}
                    podcastTitle={expandedSub.title}
                    currentKey={currentKey}
                    playing={playing}
                    onPlayEpisode={onPlayEpisode}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
