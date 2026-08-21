import { useEffect, useRef, useState } from "react";
import { Check, Copy, LayoutGrid, List, Loader2, Radio, X } from "lucide-react";
import { copyText, type IcyInfo, type Station } from "../lib/tauri";
import { isRelayOnly, stationIdentity } from "../lib/station";
import { stationIconKey } from "../lib/mediaIcon";
import {
  getSetting,
  setSetting,
  SETTINGS_EVENT,
  STATION_VIEW_KEY,
} from "../lib/settings";
import { MediaGlyph } from "./MediaGlyph";
import { Modal } from "./Modal";
import { cn } from "../lib/cn";

type View = "list" | "cards";

function loadView(): View {
  return getSetting(STATION_VIEW_KEY) === "cards" ? "cards" : "list";
}

/** Publish / unpublish one station — the toggle that separates "share this" from
 *  "keep this here".
 *
 *  Mirrors the Podcasts tab's control, and exists for the same reason: ✕ used to do
 *  both, so a station could not be tidied off one device without retracting it for
 *  every device, nor unshared without losing it locally. Hidden without a signing
 *  key, since there is nothing to publish with.
 *
 *  A row that came only from the relays has no local copy — its `d` is set and its
 *  slug is a content hash — so unpublishing it makes it disappear entirely, which the
 *  confirm says plainly. */
function PublishControl({
  station,
  signedIn,
  busy,
  published,
  onPublish,
  onUnpublish,
  compact = false,
}: {
  station: Station;
  signedIn: boolean;
  busy: boolean;
  published: boolean;
  onPublish?: (s: Station) => void;
  onUnpublish?: (s: Station) => void;
  compact?: boolean;
}) {
  if (!signedIn || (!onPublish && !onUnpublish)) return null;
  return (
    <button
      type="button"
      onClick={() => (published ? onUnpublish?.(station) : onPublish?.(station))}
      disabled={busy}
      title={
        published
          ? `Published as station.v1 — ${station.d ?? "this station"}\nClick to unpublish (kind:5). The station stays on this device.`
          : "Publish this station to the relays so your other devices see it"
      }
      className={cn(
        "shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] transition-colors disabled:opacity-40",
        published
          ? "bg-surface font-mono text-nostr hover:text-alert"
          : "border border-surface text-muted hover:border-nostr hover:text-nostr",
        compact ? "px-1" : "w-full text-center",
      )}
    >
      {busy ? "…" : published ? "published" : "publish"}
    </button>
  );
}

/** The tuner's station list. Rows are the local station store (seeded on first
 *  run) overlaid with any Nostr `station.v1` events. When `onRemove` is provided
 *  each row gets a hover ✕ that removes it from the local store (and, if signed
 *  in, publishes a kind:5 unfollow so the relay overlay stays in step) — behind a
 *  confirm, since the ✕ sits under the pointer and there's no undo. Two views —
 *  a dense list and a glyph card grid (icons from stationIconKey). */
export function StationList({
  stations,
  currentSlug,
  playing,
  loading,
  onTune,
  onRemove,
  onPublish,
  onUnpublish,
  icy,
  signedIn,
}: {
  stations: Station[];
  currentSlug: string | null;
  playing: boolean;
  loading: boolean;
  onTune: (s: Station) => void;
  onRemove?: (s: Station) => void;
  /** Publish this station as a follow. Only offered when signed in. */
  onPublish?: (s: Station) => void;
  /** Retract the published follow, leaving the local row alone. */
  onUnpublish?: (s: Station) => void;
  icy?: Record<string, IcyInfo>;
  /** Signed in — removing also publishes a kind:5 unfollow, so the confirm says so. */
  signedIn?: boolean;
}) {
  const [view, setView] = useState<View>(loadView);
  // Slug of the row whose URL was just copied — briefly shows a ✓.
  const [copied, setCopied] = useState<string | null>(null);
  // Station the user clicked ✕ on — removal waits on the confirm dialog.
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Station whose follow is about to be retracted. Publishing is one click;
  // UNpublishing asks, because it writes a deletion to every relay — the same
  // asymmetry the Podcasts tab uses.
  const [confirmUnpublish, setConfirmUnpublish] = useState<string | null>(null);
  const unpublishCancelRef = useRef<HTMLButtonElement>(null);
  // Slug currently being published/retracted, so only that row's control is busy.
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Re-read once the durable settings store finishes loading (initSettings),
  // so a migrated / non-graceful-stale view pref lands even though this list is
  // the default-mounted tab.
  useEffect(() => {
    const onSettings = () => setView(loadView());
    window.addEventListener(SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings);
  }, []);

  // Merge the station's own words with what the stream advertised. The logic lives
  // in lib/station.ts (pure, unit-tested) because it now has three sources to weigh:
  // the user's text, this session's probe, and the PERSISTED slice that carries the
  // answer before anything is tuned — which is the whole point of storing it.
  const enrich = (s: Station) => stationIdentity(s, icy?.[s.url]);

  // Focus Cancel, not the destructive button — a stray Enter/Space right after
  // the mis-click then dismisses rather than confirms.
  useEffect(() => {
    if (confirmSlug) cancelRef.current?.focus();
  }, [confirmSlug]);
  useEffect(() => {
    if (confirmUnpublish) unpublishCancelRef.current?.focus();
  }, [confirmUnpublish]);

  const publish = (s: Station) => {
    if (!onPublish) return;
    setBusySlug(s.slug);
    Promise.resolve(onPublish(s)).finally(() => setBusySlug(null));
  };
  const unpublish = (s: Station) => {
    if (!onUnpublish) return;
    setConfirmUnpublish(null);
    setBusySlug(s.slug);
    Promise.resolve(onUnpublish(s)).finally(() => setBusySlug(null));
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

  const confirmStation = confirmSlug
    ? stations.find((s) => s.slug === confirmSlug)
    : undefined;
  const unpublishStation = confirmUnpublish
    ? stations.find((s) => s.slug === confirmUnpublish)
    : undefined;

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
                  {/* A CELL, kept even when empty. Dropping it when a station
                      states no bitrate would collapse the column and drag
                      everything right of it along — the same shape as the ✕ slot
                      below. Nothing in the seeded list hits this today (a station
                      reporting 0 still renders `0k`), but the first feed that
                      omits it would. Clips rather than grows: a flex item keeps
                      `min-width: auto`, so an unusually wide value would push the
                      column left on exactly the rows carrying it. */}
                  <span className="w-10 shrink-0 truncate text-right font-mono text-xs text-muted">
                    {s.bitrate != null ? `${s.bitrate}k` : ""}
                  </span>
                </button>
                {/* Sibling of the row button, never a child — a <button> inside a
                    <button> is invalid HTML (learned on the Podcasts tab). */}
                {/* Fixed rail: `publish` and `published` are different widths (and
                    the unpublished state carries a border the published one does
                    not), so the control must not size its own column — otherwise
                    the gutter to its right dances from row to row the moment the
                    list holds one of each. */}
                {!!signedIn && (
                  <div className="flex w-[4.75rem] shrink-0 items-center pr-1">
                    <PublishControl
                      station={s}
                      signedIn={!!signedIn}
                      busy={busySlug === s.slug}
                      published={!!s.d}
                      onPublish={publish}
                      onUnpublish={() => setConfirmUnpublish(s.slug)}
                    />
                  </div>
                )}
                {/* One gutter of FIXED width holding both icon buttons. A
                    relay-only station has nothing local to remove, so ✕ is absent
                    by design — but its 2rem must stay spoken for or that row's
                    whole right-hand cluster slides right and the column goes
                    ragged. Measured before this: the published chip ended at
                    x=1814 on every local row and x=1854 on the two relay-only ones.
                    (The space has to live on the container; an empty spacer
                    element lays out at zero width here — learned on Podcasts.) */}
                <div className="flex w-16 shrink-0 items-center">
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
                  {onRemove && !isRelayOnly(s) && (
                    <button
                      type="button"
                      onClick={() => setConfirmSlug(s.slug)}
                      title={`Remove ${s.name} from this device`}
                      aria-label={`Remove ${s.name}`}
                      className="grid w-8 shrink-0 place-items-center text-muted opacity-0 transition-opacity hover:text-alert group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
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
                  <div className="absolute left-1 top-1">
                    <PublishControl
                      station={s}
                      signedIn={!!signedIn}
                      busy={busySlug === s.slug}
                      published={!!s.d}
                      onPublish={publish}
                      onUnpublish={() => setConfirmUnpublish(s.slug)}
                      compact
                    />
                  </div>
                  {onRemove && !isRelayOnly(s) && (
                    <button
                      type="button"
                      onClick={() => setConfirmSlug(s.slug)}
                      title={`Remove ${s.name} from this device`}
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

      {/* Removal is confirmed — the hover-✕ sits right where the pointer already
          is, and a removed station is gone from the local store (plus a kind:5
          unfollow when signed in). */}
      {unpublishStation && (
        <Modal title="Unpublish?" onClose={() => setConfirmUnpublish(null)}>
          <p className="text-sm text-fg">
            Stop publishing{" "}
            <span className="font-medium">{unpublishStation.name}</span>?
          </p>
          <p className="mt-1.5 break-all font-mono text-[10px] text-muted">
            {unpublishStation.d}
          </p>
          <p className="mt-2 text-xs text-muted">
            {isRelayOnly(unpublishStation)
              ? "A Nostr deletion (kind:5) goes to your relays and this row disappears — it lives only there, not on this device. Publish it again from whichever machine has it."
              : "A Nostr deletion (kind:5) goes to your relays, so your other devices stop seeing it. The station stays here, exactly as it is."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              ref={unpublishCancelRef}
              onClick={() => setConfirmUnpublish(null)}
              className="rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => unpublish(unpublishStation)}
              className="rounded-sm bg-alert px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
            >
              Unpublish
            </button>
          </div>
        </Modal>
      )}

      {onRemove && confirmStation && (
        <Modal title="Remove station?" onClose={() => setConfirmSlug(null)}>
          <p className="text-sm text-fg">
            Remove <span className="font-medium">{confirmStation.name}</span> from
            your stations?
          </p>
          <p className="mt-1.5 break-all font-mono text-[10px] text-muted">
            {confirmStation.url}
          </p>
          <p className="mt-2 text-xs text-muted">
            {confirmStation.d
              ? "It goes from this device only. You still publish this station, so it stays in the list marked “relay” until you turn “published” off — nothing is sent to the relays by removing it here."
              : "It's dropped from this device only — you can add the stream URL back at any time."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              ref={cancelRef}
              onClick={() => setConfirmSlug(null)}
              className="rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onRemove(confirmStation);
                setConfirmSlug(null);
              }}
              className="rounded-sm bg-alert px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
