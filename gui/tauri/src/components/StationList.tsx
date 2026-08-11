import { useEffect, useState } from "react";
import { Check, Copy, LayoutGrid, List, Loader2, Radio, X } from "lucide-react";
import { copyText, type IcyInfo, type Station } from "../lib/tauri";
import { stationIconKey } from "../lib/mediaIcon";
import {
  getSetting,
  setSetting,
  SETTINGS_EVENT,
  STATION_VIEW_KEY,
} from "../lib/settings";
import { MediaGlyph } from "./MediaGlyph";
import { cn } from "../lib/cn";

type View = "list" | "cards";

function loadView(): View {
  return getSetting(STATION_VIEW_KEY) === "cards" ? "cards" : "list";
}

/** The tuner's station list. Rows are the local station store (seeded on first
 *  run) overlaid with any Nostr `station.v1` events. When `onRemove` is provided
 *  each row gets a hover ✕ that removes it from the local store (and, if signed
 *  in, publishes a kind:5 unfollow so the relay overlay stays in step). Two
 *  views — a dense list and a glyph card grid (icons from stationIconKey). */
export function StationList({
  stations,
  currentSlug,
  playing,
  loading,
  onTune,
  onRemove,
  icy,
}: {
  stations: Station[];
  currentSlug: string | null;
  playing: boolean;
  loading: boolean;
  onTune: (s: Station) => void;
  onRemove?: (s: Station) => void;
  icy?: Record<string, IcyInfo>;
}) {
  const [view, setView] = useState<View>(loadView);
  // Slug of the row whose URL was just copied — briefly shows a ✓.
  const [copied, setCopied] = useState<string | null>(null);

  // Re-read once the durable settings store finishes loading (initSettings),
  // so a migrated / non-graceful-stale view pref lands even though this list is
  // the default-mounted tab.
  useEffect(() => {
    const onSettings = () => setView(loadView());
    window.addEventListener(SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings);
  }, []);

  // Merge the harvested station.v1 description with ICY headers captured on
  // tune-in (win #2). Gap-fill only — the station's own description wins; ICY's
  // icy-name backfills it, and icy-url adds a homepage stations otherwise lack.
  const enrich = (s: Station) => {
    const info = icy?.[s.url];
    const homepage = info?.homepage
      ? info.homepage.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : null;
    return { description: s.description || info?.name || null, homepage };
  };

  const chooseView = (v: View) => {
    setView(v);
    setSetting(STATION_VIEW_KEY, v);
  };
  const copy = (s: Station) => {
    copyText(s.url)
      .then(() => {
        setCopied(s.slug);
        setTimeout(() => setCopied((c) => (c === s.slug ? null : c)), 1200);
      })
      .catch((e) => console.error("copy failed", e));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" />
        loading stations…
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="p-4 text-sm text-muted">
        No stations. Use <span className="text-fg">Add</span> to save a stream
        URL — it's kept on this device.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* View toggle */}
      <div className="flex items-center px-3 pb-1">
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
          {stations.map((s) => {
            const current = s.slug === currentSlug;
            const meta = enrich(s);
            return (
              <li key={s.slug} className="group relative flex items-stretch">
                <button
                  type="button"
                  onClick={() => onTune(s)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left",
                    "border-l-2 border-transparent transition-colors",
                    "hover:bg-surfaceHover",
                    current && "border-accent bg-surface",
                  )}
                >
                  {/* Source dot — green when this station is the one playing. The
                      full lib/source.ts dot model lands with matched/unmatched. */}
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      current && playing ? "bg-ok" : "bg-muted/50",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Radio
                        size={14}
                        className={cn(current ? "text-accent" : "text-muted")}
                      />
                      <span className="truncate text-sm text-fg">{s.name}</span>
                    </span>
                    {s.tags.length > 0 && (
                      <span className="mt-0.5 block truncate pl-6 text-xs text-muted">
                        {s.tags.join(" · ")}
                      </span>
                    )}
                    {meta.description && (
                      <span
                        className="mt-0.5 block truncate pl-6 text-xs text-muted/70"
                        title={meta.description}
                      >
                        {meta.description}
                      </span>
                    )}
                    {meta.homepage && (
                      <span
                        className="mt-0.5 block truncate pl-6 font-mono text-[10px] text-muted/60"
                        title={meta.homepage}
                      >
                        {meta.homepage}
                      </span>
                    )}
                  </span>
                  {s.bitrate != null && (
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {s.bitrate}k
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copy(s)}
                  title={`Copy ${s.name} URL`}
                  aria-label={`Copy ${s.name} stream URL`}
                  className={cn(
                    "grid w-8 shrink-0 place-items-center text-muted transition-opacity hover:text-fg",
                    copied === s.slug ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  {copied === s.slug ? (
                    <Check size={14} className="text-ok" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(s)}
                    title={`Remove ${s.name}`}
                    aria-label={`Remove ${s.name}`}
                    className="grid w-8 shrink-0 place-items-center text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-3 pb-3">
          <div className="overflow-x-auto pb-1">
          <div className="flex items-stretch gap-2">
            {stations.map((s) => {
              const current = s.slug === currentSlug;
              const meta = enrich(s);
              return (
                <div
                  key={s.slug}
                  className="group relative shrink-0 min-w-[136px] basis-[calc((100%_-_4.5rem)/10)]"
                >
                  <button
                    type="button"
                    onClick={() => onTune(s)}
                    title={s.name}
                    aria-pressed={current}
                    className={cn(
                      "flex h-full w-full flex-col items-center gap-2 rounded-sm border p-3 text-center transition-colors",
                      current
                        ? "border-accent bg-surface"
                        : "border-surface hover:bg-surfaceHover",
                    )}
                  >
                    <MediaGlyph iconKey={stationIconKey(s.name, s.tags)} size={48} />
                    <span className="line-clamp-2 text-xs leading-snug text-fg">
                      {s.name}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted/70">
                      {[s.tags[0], s.bitrate != null ? `${s.bitrate}k` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {meta.description && (
                      <span
                        className="line-clamp-2 max-w-full text-[10px] leading-tight text-muted/70"
                        title={meta.description}
                      >
                        {meta.description}
                      </span>
                    )}
                    {meta.homepage && (
                      <span
                        className="max-w-full truncate font-mono text-[9px] text-muted/60"
                        title={meta.homepage}
                      >
                        {meta.homepage}
                      </span>
                    )}
                  </button>
                  {/* Live dot for the playing station */}
                  {current && playing && (
                    <span
                      className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-ok"
                      aria-hidden
                    />
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(s)}
                      title={`Remove ${s.name}`}
                      aria-label={`Remove ${s.name}`}
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
        </div>
      )}
    </div>
  );
}
