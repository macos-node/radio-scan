import { useState } from "react";
import { Loader2, Radio } from "lucide-react";
import { Modal } from "./Modal";
import { addLocalStation, publishStation, stationIcy } from "../lib/tauri";
import { slugify, type Station } from "../lib/station";

/** Probe a URL's content-type (reusing the ICY header fetch) to catch a feed or
 *  web page pasted as a stream. `audio` is true/false when the content-type is
 *  conclusive, null when there's no content-type or the probe errors — an
 *  inconclusive probe must never block a genuine stream that just doesn't
 *  advertise its type. `hint` names what the non-audio URL looks like. */
async function audioVerdict(
  url: string,
): Promise<{ audio: boolean | null; contentType: string; hint: string }> {
  try {
    const info = await stationIcy(url);
    const ct = (info.fmt || "").toLowerCase();
    if (!ct) return { audio: null, contentType: "", hint: "" };
    const isAudio =
      ct.startsWith("audio/") ||
      ct.includes("ogg") ||
      ct.includes("mpegurl") || // HLS / m3u
      ct.includes("aacp");
    const hint = ct.includes("xml") || ct.includes("rss")
      ? "feed"
      : ct.includes("html")
        ? "web page"
        : ct.includes("json")
          ? "data feed"
          : "non-audio resource";
    return { audio: isAudio, contentType: info.fmt || ct, hint };
  } catch {
    return { audio: null, contentType: "", hint: "" };
  }
}

/** Add a stream. Always saves to the local station store (persisted on this
 *  device, no key required); when signed in it ALSO publishes a station.v1 to
 *  the relays (best-effort — a relay failure never loses the local save). The
 *  saved station is handed back for an immediate insert. */
export function AddStationDialog({
  hasIdentity,
  onClose,
  onAdded,
}: {
  hasIdentity: boolean;
  onClose: () => void;
  onAdded: (station: Station) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [genres, setGenres] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when a probe finds the URL is not an audio stream; a second submit with
  // this present overrides and adds anyway.
  const [warn, setWarn] = useState<string | null>(null);

  const canSubmit = name.trim() !== "" && url.trim() !== "" && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const tags = genres
        .split(",")
        .map((t) => slugify(t))
        .filter(Boolean);
      const slug = slugify(name);
      const trimmedName = name.trim();
      const trimmedUrl = url.trim();
      const trimmedDescription = description.trim();

      // Guard the common footgun: a feed / web-page URL pasted as a stream (this
      // is how On The Wire + A Duck in a Tree ended up as dead station rows). On
      // the first submit, probe the content-type; if it's explicitly non-audio,
      // warn and bail — a second click (warn now set) overrides. Inconclusive
      // probes never block.
      if (!warn) {
        const v = await audioVerdict(trimmedUrl);
        if (v.audio === false) {
          setWarn(
            `That URL returned ${v.contentType} — it looks like a ${v.hint}, not an audio stream. ` +
              `Podcast / RSS feeds go in the Podcasts tab. Click “Add anyway” to override.`,
          );
          setBusy(false);
          return;
        }
      }

      // Local save first — this is the durable one and must not depend on relays.
      const station = await addLocalStation({
        slug,
        name: trimmedName,
        url: trimmedUrl,
        tags,
        description: trimmedDescription || null,
      });
      onAdded(station);

      // If signed in, mirror it to the relays too. A publish failure is
      // surfaced but the station is already saved locally, so we still close.
      if (hasIdentity) {
        try {
          await publishStation({
            slug,
            name: trimmedName,
            url: trimmedUrl,
            tags,
            description: trimmedDescription,
          });
        } catch (e) {
          console.error("publish_station failed (saved locally)", e);
        }
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-sm border border-surface bg-surface px-2.5 py-2 text-sm text-fg outline-none focus:border-accent";

  return (
    <Modal title="Add a station" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-xs text-muted">Name</label>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acid Jazz"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted">Stream URL</label>
          <input
            className={`${field} font-mono text-xs`}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setWarn(null); // re-probe an edited URL
            }}
            placeholder="http://host:8000/mount"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted">
            Genres <span className="text-muted/60">(comma-separated, optional)</span>
          </label>
          <input
            className={field}
            value={genres}
            onChange={(e) => setGenres(e.target.value)}
            placeholder="acid-jazz, funk, soul"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted">
            Description <span className="text-muted/60">(optional)</span>
          </label>
          <textarea
            className={`${field} resize-none`}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A nicely chilled plate of ambient beats…"
          />
        </div>
        {name.trim() && (
          <p className="font-mono text-[10px] text-muted/70">
            d = airplay:station:{slugify(name) || "…"}
          </p>
        )}
        <p className="text-[10px] text-muted/70">
          {hasIdentity
            ? "Saved on this device and published to your relays."
            : "Saved on this device. Set a signing key to also publish to relays."}
        </p>
        {warn && <p className="text-xs text-warn">{warn}</p>}
        {error && <p className="text-xs text-alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-3 py-1.5 text-xs text-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-sm bg-nostr px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Radio size={13} />
            )}
            {warn ? "Add anyway" : "Add station"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
