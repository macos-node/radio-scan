import { openUrl } from "@tauri-apps/plugin-opener";
import { Globe } from "lucide-react";
import { cn } from "../lib/cn";

/** A globe link-out to a show's homepage, opened in the system browser. Muted
 *  until hovered, then full white.
 *
 *  It sits OUTSIDE a card's own button (absolutely positioned on the card) — a
 *  button inside a button is invalid — and is lifted above it (`z-10`) with the
 *  click stopped here, so opening the site never also plays the episode. The
 *  24 px round target is deliberately bigger than the 14 px glyph.
 *
 *  `href` must already be vetted as http(s) (see showHomepage): `openUrl` acts
 *  on any scheme it's given. */
export function WwwLink({ href, className }: { href: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void openUrl(href);
      }}
      title={`Open ${href}`}
      aria-label={`Open the show's website: ${href}`}
      className={cn(
        "z-10 grid h-6 w-6 place-items-center rounded-full text-muted/70 transition-colors hover:text-white focus-visible:text-white",
        className,
      )}
    >
      <Globe size={14} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
