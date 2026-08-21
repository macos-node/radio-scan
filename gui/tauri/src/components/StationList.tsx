import { useEffect, useRef, useState } from "react";
import { Check, Copy, LayoutGrid, List, Loader2, Radio, X } from "lucide-react";
import { copyText, type IcyInfo, type Station } from "../lib/tauri";
import { isRelayOnly, stationIdentity, stationSyncCounts } from "../lib/station";
import { describeOutcome, publishSequentially } from "../lib/publishAll";
import { stationIconKey } from "../lib/mediaIcon";
import {
  getSetting,
  setSetting,
  SETTINGS_EVENT,
  STATION_VIEW_KEY,
} from "../lib/settings";
import { MediaGlyph } from "./MediaGlyph";
import { Modal } from "./Modal";
import { StateSlots } from "./StateSlots";
import { cn } from "../lib/cn";

type View = "list" | "cards";

function loadView(): View {
  return getSetting(STATION_VIEW_KEY) === "cards" ? "cards" : "list";
}

/** The Stations tab's reading of the shared two-slot control (components/
 *  StateSlots.tsx, which the Podcasts list uses too).
 *
 *  It answers the same two questions the Podcasts rows answer — is this station
 *  HERE (in this device's store) and is it PUBLISHED (served by your relays as a
 *  `station.v1`)? Before this the answers were spread across a `published` text
 *  chip and whether ✕ was drawn at all, which meant a station published from
 *  another machine was identifiable only by a MISSING control: the one signal a
 *  reader cannot see.
 *
 *  The words are this tab's own — a station is KEPT where a podcast is
 *  SUBSCRIBED — but the shape and the rules are shared, so the two lists cannot
 *  drift into describing one situation differently. Publishing is one click;
 *  unpublishing asks, because it writes a deletion to every relay; and removing
 *  the local copy stays on ✕, which asks too. */
function StationState({
  station,
  signedIn,
  busy,
  onPublish,
  onUnpublish,
  onAdopt,
  compact = false,
}: {
  station: Station;
  signedIn: boolean;
  busy: boolean;
  onPublish?: (s: Station) => void;
  onUnpublish?: (s: Station) => void;
  onAdopt?: (s: Station) => void;
  compact?: boolean;
}) {
  const here = !isRelayOnly(station);
  const published = !!station.d;
  const canToggle = published ? !!onUnpublish : !!onPublish;
  return (
    <StateSlots
      here={here}
      published={published}
      signedIn={signedIn}
      busy={busy}
      onAdopt={here || !onAdopt ? undefined : () => onAdopt(station)}
      onPublishToggle={
        canToggle
          ? () => (published ? onUnpublish?.(station) : onPublish?.(station))
          : undefined
      }
      titles={{
        device: here
          ? "Kept on this device."
          : "Published from another device, not kept on this one.\nClick to save it here — the stream URL comes from the published station itself.",
        relay: published
          ? `Published to your relays as station.v1 — ${station.d}\nClick to unpublish (kind:5). The station stays on this device.`
          : "Not published. Click to publish this station so your other devices see it.",
      }}
      labels={{
        device: `Save ${station.name} to this device`,
        relay: published ? `Unpublish ${station.name}` : `Publish ${station.name}`,
      }}
      compact={compact}
    />
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
  onAdopt,
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
  /** Save a station this device does not hold — one published from another
   *  machine — into the local store. Local only; nothing is published. */
  onAdopt?: (s: Station) => void | Promise<void>;
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
  // Progress / summary for a bulk run, in the status line's own slot.
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  // Publishing the whole list at once is a bulk public act, so it asks.
  const [confirmPublishAll, setConfirmPublishAll] = useState(false);

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

  /** How far this device and the relays have converged — the same reading, from
   *  the same helper, that the Podcasts tab gives. */
  const counts = stationSyncCounts(stations);
  const notHere = stations.filter((s) => isRelayOnly(s));
  const unpublished = stations.filter((s) => !isRelayOnly(s) && !s.d);

  const say = (msg: string) => {
    setBulkMsg(msg);
    setTimeout(() => setBulkMsg((m) => (m === msg ? null : m)), 4000);
  };

  const adopt = (s: Station) => {
    if (!onAdopt) return;
    Promise.resolve(onAdopt(s)).catch((e) =>
      console.error("adopt station failed", e),
    );
  };

  /** Take every station published from another device onto this one. Sequential
   *  because each one is a store write, and a store that rewrites the same file
   *  per entry should not be asked to do it from twelve directions at once. Local
   *  only, so no confirm: nothing is published — every station it saves is already
   *  a `station.v1` on the relays, which is why the row is on screen — and each is
   *  undone by its own ✕, which does ask. */
  const adoptAll = async () => {
    if (!onAdopt || notHere.length === 0) return;
    const outcome = await publishSequentially(
      notHere,
      (s) => Promise.resolve(onAdopt(s)),
      {
        delayMs: 0,
        onProgress: (done, total) =>
          setBulkMsg(done < total ? `adding ${done + 1}/${total}…` : null),
      },
    );
    for (const f of outcome.failed) {
      console.error("adopt station failed", f.item.slug, f.error);
    }
    say(describeOutcome(outcome, "added"));
  };

  /** Publish every station this device holds and has never shared. Sequential and
   *  behind a confirm, unlike adoptAll: this one writes to every relay, once per
   *  station — the same line the Podcasts tab draws between `add all` and
   *  `follow all`. */
  const publishAll = async () => {
    setConfirmPublishAll(false);
    if (!onPublish || unpublished.length === 0) return;
    const outcome = await publishSequentially(
      unpublished,
      (s) => Promise.resolve(onPublish(s)),
      {
        onProgress: (done, total) =>
          setBulkMsg(done < total ? `publishing ${done + 1}/${total}…` : null),
      },
    );
    for (const f of outcome.failed) {
      console.error("publish_station failed", f.item.slug, f.error);
    }
    say(describeOutcome(outcome));
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
      {/* The three-way state in one line, worded exactly as the Podcasts tab
          words it: how many stations there are, how many are on THIS device, how
          many are published to your relays. The counts overlap on purpose (a
          synced station is both), so they are not meant to add up; the gaps are
          what you act on, and those are the two buttons. */}
      <div className="flex items-center gap-2 px-3 pb-1">
        <span
          className="font-mono text-[10px] text-muted/60"
          title={
            signedIn
              ? "stations in this list · kept on this device · published to your relays as station.v1"
              : "stations in this list · kept on this device"
          }
        >
          {counts.total} stations · {counts.here} here
          {signedIn && ` · ${counts.published} published`}
        </span>
        {signedIn && counts.inSync && !bulkMsg && (
          <span
            className="flex items-center gap-1 font-mono text-[10px] text-ok"
            title={
              "Everything here is published, and everything published is here.\n" +
              "This speaks for THIS device only — another machine is in sync when it says so itself."
            }
          >
            <Check size={11} />
            in sync
          </span>
        )}
        {bulkMsg && (
          <span className="font-mono text-[10px] text-accent">{bulkMsg}</span>
        )}
        {!bulkMsg && onAdopt && notHere.length > 0 && (
          <button
            type="button"
            onClick={() => void adoptAll()}
            title={`Save ${notHere.length} station(s) published from another device onto this one. Local only — nothing is published.`}
            className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
          >
            add all ({notHere.length})
          </button>
        )}
        {!bulkMsg && signedIn && onPublish && unpublished.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmPublishAll(true)}
            title={`Publish ${unpublished.length} station(s) this device holds but has not shared`}
            className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surfaceHover hover:text-nostr"
          >
            publish all ({unpublished.length})
          </button>
        )}
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
                {/* Fixed rail, drawn signed in or out: the device slot means
                    something without a key, and a column that appears and
                    disappears is the raggedness this layout just removed. */}
                <div className="flex w-12 shrink-0 items-center pr-1">
                  <StationState
                    station={s}
                    signedIn={!!signedIn}
                    busy={busySlug === s.slug}
                    onPublish={publish}
                    onUnpublish={() => setConfirmUnpublish(s.slug)}
                    onAdopt={onAdopt ? adopt : undefined}
                  />
                </div>
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
                    <StationState
                      station={s}
                      signedIn={!!signedIn}
                      busy={busySlug === s.slug}
                      onPublish={publish}
                      onUnpublish={() => setConfirmUnpublish(s.slug)}
                      onAdopt={onAdopt ? adopt : undefined}
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

      {/* Publishing the whole list is a bulk PUBLIC act, so it asks — the same
          line the Podcasts tab draws between `add all` (local, silent) and
          `follow all` (relays, confirmed). */}
      {confirmPublishAll && (
        <Modal title="Publish all?" onClose={() => setConfirmPublishAll(false)}>
          <p className="text-sm text-fg">
            Publish{" "}
            <span className="font-medium">
              {unpublished.length} station{unpublished.length === 1 ? "" : "s"}
            </span>{" "}
            to your relays?
          </p>
          <p className="mt-2 text-xs text-muted">
            Only the stations this device keeps and has not published yet. Anything
            already published is left alone, and stations that came from another
            device are never re-published from here. They go out one at a time, so a
            long list takes a moment.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmPublishAll(false)}
              className="rounded-sm border border-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surfaceHover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void publishAll()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90"
            >
              Publish all
            </button>
          </div>
        </Modal>
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
