import { useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Modal } from "./Modal";
import { exportJson, exportText, openImportFile } from "../lib/tauri";
import {
  buildOpml,
  loadSubs,
  mergeSubs,
  parseOpml,
  parseSubsJson,
  setPodcasts,
} from "../lib/podcasts";
import { parseStationsJson, type Station } from "../lib/station";

/** App-level Backup & Restore. Exports both stores in one file (or podcasts as
 *  portable OPML), and restores by routing entries to the right store BY SHAPE —
 *  so the user doesn't have to pick the right tab. Stations live in App's Rust
 *  store (restore delegated via onRestoreStations); podcasts write straight
 *  through the shared podcasts module (which nudges an open Podcasts tab). */
export function BackupDialog({
  stations,
  onRestoreStations,
  onClose,
}: {
  stations: Station[];
  onRestoreStations: (incoming: Station[]) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = (m: string) => {
    setError(null);
    setMsg(m);
  };

  const backupJson = async () => {
    setError(null);
    try {
      const podcasts = loadSubs();
      const path = await exportJson("ntune-backup.json", {
        app: "ntune",
        version: 1,
        stations,
        podcasts,
      });
      if (path)
        flash(`Backed up ${stations.length} stations + ${podcasts.length} podcasts`);
    } catch (e) {
      setError(String(e));
    }
  };

  const backupOpml = async () => {
    setError(null);
    try {
      const podcasts = loadSubs();
      const path = await exportText(
        "ntune-podcasts.opml",
        buildOpml(podcasts),
        "opml",
      );
      if (path) flash(`Exported ${podcasts.length} podcasts as OPML`);
    } catch (e) {
      setError(String(e));
    }
  };

  const restore = async () => {
    setError(null);
    setBusy(true);
    try {
      const file = await openImportFile();
      if (!file) return; // cancelled
      const looksXml = /^\s*</.test(file.text) || /\.(opml|xml)$/i.test(file.path);

      // OPML is always a feed list -> podcasts.
      if (looksXml) {
        const subs = parseOpml(file.text);
        setPodcasts(mergeSubs(loadSubs(), subs));
        flash(`Restored ${subs.length} podcasts (OPML)`);
        return;
      }

      const data: unknown = JSON.parse(file.text);

      // Full backup object: { stations?, podcasts? } -> both stores.
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.stations) || Array.isArray(obj.podcasts)) {
          let np = 0;
          let ns = 0;
          if (Array.isArray(obj.podcasts)) {
            const subs = parseSubsJson(obj.podcasts);
            setPodcasts(mergeSubs(loadSubs(), subs));
            np = subs.length;
          }
          if (Array.isArray(obj.stations)) {
            const sts = parseStationsJson(obj.stations);
            await onRestoreStations(sts);
            ns = sts.length;
          }
          flash(`Restored ${ns} stations + ${np} podcasts`);
          return;
        }
      }

      // Bare array — route by shape: stations carry name/slug, podcasts carry title.
      if (Array.isArray(data)) {
        const looksStations = data.some(
          (r) =>
            r &&
            typeof r === "object" &&
            ("name" in r || "slug" in r) &&
            !("title" in r),
        );
        if (looksStations) {
          const sts = parseStationsJson(data);
          await onRestoreStations(sts);
          flash(`Restored ${sts.length} stations`);
        } else {
          const subs = parseSubsJson(data);
          setPodcasts(mergeSubs(loadSubs(), subs));
          flash(`Restored ${subs.length} podcasts`);
        }
        return;
      }

      throw new Error("unrecognised file — expected a backup, OPML, or list");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const btn =
    "flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-surface px-3 py-2 text-xs text-fg transition-colors hover:bg-surfaceHover disabled:opacity-40";

  return (
    <Modal title="Backup & Restore" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Back up everything — stations + podcasts — to one file, or export your
            podcasts as portable OPML for any other feed app.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={backupJson} className={btn}>
              <Download size={14} /> Full backup (.json)
            </button>
            <button type="button" onClick={backupOpml} className={btn}>
              <Download size={14} /> Podcasts (.opml)
            </button>
          </div>
        </div>

        <div className="space-y-2 border-t border-surface pt-3">
          <p className="text-xs text-muted">
            Restore from a backup, an OPML feed list, or a stations / podcasts JSON.
            Entries are routed to the right list and merged (deduped by URL).
          </p>
          <button
            type="button"
            onClick={restore}
            disabled={busy}
            className={btn}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            Restore from file…
          </button>
        </div>

        {msg && <p className="text-xs text-ok">{msg}</p>}
        {error && <p className="text-xs text-alert">{error}</p>}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-3 py-1.5 text-xs text-muted hover:text-fg"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
