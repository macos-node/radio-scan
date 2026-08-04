import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Square, quiet toolbar button — the suite's header/control affordance. */
export function ToolbarIconButton({
  icon,
  title,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
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
        "grid h-8 w-8 place-items-center rounded-sm border border-transparent",
        "text-muted transition-colors",
        "hover:bg-surfaceHover hover:text-fg",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-surface text-fg",
      )}
    >
      {icon}
    </button>
  );
}
