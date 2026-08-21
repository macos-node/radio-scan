import { Laptop, Loader2, Share2 } from "lucide-react";
import { cn } from "../lib/cn";

/** The two-slot state control, shared by the Podcasts and Stations lists.
 *
 *  A row in either list answers the same two questions — is this thing HERE (held
 *  on this device) and is it PUBLISHED (served by your relays as a `show.v1` /
 *  `station.v1`)? Both slots are drawn in the same two positions on every row, so
 *  the state is a shape you scan down a column rather than a sentence you
 *  reassemble per row. This component owns the shape; the WORDS belong to the
 *  caller, because a podcast is subscribed and a station is kept, and neither tab
 *  should have to speak the other's vocabulary to share a control.
 *
 *  Deliberately asymmetrical. A filled device slot is an indicator, not a button:
 *  removing something local stays on ✕, which asks first, because one stray click
 *  on a hover-revealed row must not drop it. Publishing is one click (additive,
 *  undone by clicking again); retracting asks, because it writes to every relay. */
export function StateSlots({
  here,
  published,
  signedIn,
  busy,
  onAdopt,
  onPublishToggle,
  titles,
  labels,
  compact = false,
}: {
  /** Held on this device. */
  here: boolean;
  /** Served by the relays as this user's own addressable event. */
  published: boolean;
  /** A signing key is loaded — without one the relay slot is hidden entirely,
   *  since there is nothing to publish with and a dead control explains less than
   *  no control. */
  signedIn: boolean;
  busy: boolean;
  /** Take a not-here row onto this device. Omitted when there is nothing to take
   *  (the row is already here), which is what makes that slot an indicator. */
  onAdopt?: () => void;
  onPublishToggle?: () => void;
  titles: { device: string; relay: string };
  labels: { device: string; relay: string };
  compact?: boolean;
}) {
  const size = compact ? 11 : 13;
  const slot = cn(
    "grid shrink-0 place-items-center rounded-sm transition-colors",
    compact ? "h-4 w-4" : "h-5 w-5",
  );
  return (
    <div className={cn("flex shrink-0 items-center", compact ? "gap-0.5" : "gap-1")}>
      {here || !onAdopt ? (
        <span
          className={cn(slot, here ? "bg-surface text-fg/80" : "text-muted/40")}
          title={titles.device}
        >
          <Laptop size={size} />
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdopt}
          title={titles.device}
          aria-label={labels.device}
          className={cn(slot, "text-muted/40 hover:bg-surfaceHover hover:text-fg")}
        >
          <Laptop size={size} />
        </button>
      )}
      {/* Published state is not local state: this reflects an event read back off
          the relays, so it lights up when the event lands, not when the click
          happens. */}
      {signedIn && onPublishToggle && (
        <button
          type="button"
          onClick={onPublishToggle}
          disabled={busy}
          title={titles.relay}
          aria-label={labels.relay}
          className={cn(
            slot,
            "disabled:opacity-40",
            published
              ? "bg-surface text-nostr hover:text-alert"
              : "text-muted/40 hover:bg-surfaceHover hover:text-nostr",
          )}
        >
          {busy ? (
            <Loader2 size={size} className="animate-spin" />
          ) : (
            <Share2 size={size} />
          )}
        </button>
      )}
    </div>
  );
}
