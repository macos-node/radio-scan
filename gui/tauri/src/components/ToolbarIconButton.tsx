import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Square, quiet toolbar button — the suite's header/control affordance. */
export function ToolbarIconButton({
  icon,
  title,
  onClick,
  active = false,
  disabled = false,
  badge = false,
}: {
  icon: ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** A dot in the corner: there is something new behind this button.
   *
   *  A STATUS token, not `--c-mauve`. index.css states the rule for the mono
   *  theme — chrome goes greyscale, meaning keeps its colour — and a dot whose
   *  whole job is hue is meaning. Built with mauve first and it rendered grey on
   *  grey under mono, signalling nothing.
   *
   *  Its PRESENCE is the signal and hue only reinforces it, so it survives being
   *  unseen; `title` names what is new, which is what hover and a screen reader
   *  get. */
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative grid h-8 w-8 place-items-center rounded-sm border border-transparent",
        "text-muted transition-colors",
        "hover:bg-surfaceHover hover:text-fg",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-surface text-fg",
      )}
    >
      {icon}
      {badge && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warn"
        />
      )}
    </button>
  );
}
