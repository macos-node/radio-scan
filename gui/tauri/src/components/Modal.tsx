import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** Minimal centered overlay dialog. Click the backdrop, press Escape, or ✕ to
 *  dismiss. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape dismisses — the reflex for any dialog, and the safe way out of a
  // destructive confirm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-md border border-surface bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-surface px-4 py-2.5">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-surfaceHover hover:text-fg"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
