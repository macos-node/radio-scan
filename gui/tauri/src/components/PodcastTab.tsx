import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Music,
  Play,
  Plus,
  Rss,
  X,
} from "lucide-react";
import {
  copyText,
  exportJson,
  fetchPodcast,
  type Episode,
  type Podcast,
} from "../lib/tauri";
import { cn } from "../lib/cn";

interface Sub {
  url: string;
  title: string;
}

const SUBS_KEY = "ntune.podcasts";

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

/** Podcasts tab (U4): subscribe by RSS URL (localStorage), browse episodes
 *  fetched via Rust feed-rs, play through the shared player. */
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
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Podcast>>({});
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  // Feed URL just copied to the clipboard — briefly shows a ✓ on that row.
  const [copied, setCopied] = useState<string | null>(null);

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
                    <span className="truncate text-sm text-fg">{s.title}</span>
                    {loadingUrl === s.url && (
                      <Loader2 size={12} className="animate-spin text-muted" />
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
                  <ul className="flex flex-col pb-1">
                    {pod.episodes.length === 0 && (
                      <li className="px-9 py-2 text-xs text-muted">
                        No audio episodes found in this feed.
                      </li>
                    )}
                    {pod.episodes.slice(0, 100).map((ep) => {
                      const isCurrent = ep.id === currentKey;
                      return (
                        <li key={ep.id}>
                          <button
                            type="button"
                            onClick={() => onPlayEpisode(ep, s.title)}
                            className={cn(
                              "flex w-full items-center gap-2 py-1.5 pl-9 pr-3 text-left hover:bg-surfaceHover",
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
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
