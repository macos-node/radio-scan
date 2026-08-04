import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import {
  clearIdentity,
  generateIdentity,
  importIdentity,
  type Identity,
} from "../lib/tauri";

/** Manage the signing key held in the OS keychain. Publishing station.v1 (U2)
 *  needs it; reading does not. The nsec only ever leaves Rust once, on generate,
 *  so it can be backed up. */
export function IdentityDialog({
  identity,
  onClose,
  onChange,
}: {
  identity: Identity | null;
  onClose: () => void;
  onChange: (id: Identity | null) => void;
}) {
  const [nsec, setNsec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The freshly-generated nsec, shown once for backup.
  const [fresh, setFresh] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = () =>
    run(async () => {
      const id = await importIdentity(nsec.trim());
      setNsec("");
      onChange(id);
    });

  const doGenerate = () =>
    run(async () => {
      const id = await generateIdentity();
      setFresh(id.nsec);
      onChange({ npub: id.npub, pk: id.pk });
    });

  const doClear = () =>
    run(async () => {
      await clearIdentity();
      onChange(null);
    });

  return (
    <Modal title="Signing key" onClose={onClose}>
      {identity ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Signed in. Following a station publishes a{" "}
            <span className="font-mono text-nostr">station.v1</span> event as this
            key.
          </p>
          <div className="break-all rounded-sm bg-surface px-2.5 py-2 font-mono text-xs text-fg">
            {identity.npub}
          </div>
          {fresh && (
            <div className="space-y-1 rounded-sm border border-warn/40 bg-warn/5 px-2.5 py-2">
              <p className="text-xs font-semibold text-warn">
                Back this up now — it is shown once.
              </p>
              <div className="break-all font-mono text-xs text-fg">{fresh}</div>
            </div>
          )}
          <button
            type="button"
            onClick={doClear}
            disabled={busy}
            className="text-xs text-alert hover:underline disabled:opacity-40"
          >
            Forget key on this machine
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted">
              Import your suite key (one npub per person)
            </label>
            <input
              type="password"
              value={nsec}
              onChange={(e) => setNsec(e.target.value)}
              placeholder="nsec1…"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-sm border border-surface bg-surface px-2.5 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={doImport}
              disabled={busy || !nsec.trim()}
              className="flex items-center gap-1.5 rounded-sm bg-nostr px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              Import
            </button>
          </div>
          <div className="border-t border-surface pt-3">
            <p className="mb-2 text-xs text-muted">
              …or create a new identity (only if you don't already have one).
            </p>
            <button
              type="button"
              onClick={doGenerate}
              disabled={busy}
              className="rounded-sm border border-surface px-3 py-1.5 text-xs text-fg hover:bg-surfaceHover disabled:opacity-40"
            >
              Generate new key
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-alert">{error}</p>}
    </Modal>
  );
}
