import type { Config } from "tailwindcss";

// Themeable palette — values come from CSS custom properties in src/index.css.
// The channel-triple form keeps Tailwind's `/opacity` modifiers working
// (e.g. bg-accent/5 → rgb(var(--c-accent) / 0.05)). Mirrors nplay / ndisc.
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("--c-bg"),
        panel: c("--c-panel"),
        surface: c("--c-surface"),
        surfaceHover: c("--c-surface-hover"),
        fg: c("--c-fg"),
        muted: c("--c-muted"),
        accent: c("--c-accent"),
        digital: c("--c-digital"),
        ok: c("--c-ok"),
        warn: c("--c-warn"),
        alert: c("--c-alert"),
        mauve: c("--c-mauve"),
        auburn: c("--c-auburn"),
        medium: c("--c-medium"),
        // Theme-neutral Nostr tint — used by publish/relay affordances so they
        // read the same under every theme (suite rule: never --c-mauve for
        // Nostr UI). Defined once in :root and not overridden per theme.
        nostr: c("--c-nostr"),
      },
      fontFamily: {
        sans: ["Helvetica", "Arial", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
