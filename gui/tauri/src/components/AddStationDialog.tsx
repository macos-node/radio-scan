import { useState } from "react";
import { Loader2, Radio } from "lucide-react";
import { Modal } from "./Modal";
import { publishStation } from "../lib/tauri";
import { slugify } from "../lib/station";

/** Follow a stream: publish a station.v1. On success the live relay
 *  subscription reads the new event straight back into the list. */
export function AddStationDialog({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [genres, setGenres] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() !== "" && url.trim() !== "" && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const tags = genres
        .split(",")
        .map((t) => slugify(t))
        .filter(Boolean);
      await publishStation({
        slug: slugify(name),
        name: name.trim(),
        url: url.trim(),
        tags,
        description: "",
      });
      onPublished();
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
    <Modal title="Follow a station" onClose={onClose}>
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
            onChange={(e) => setUrl(e.target.value)}
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
        {name.trim() && (
          <p className="font-mono text-[10px] text-muted/70">
            d = airplay:station:{slugify(name) || "…"}
          </p>
        )}
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
            Publish &amp; follow
          </button>
        </div>
      </div>
    </Modal>
  );
}
