import { defineConfig } from "vitest/config";

// Unit tests for pure logic (no DOM) — e.g. the media-icon matcher. Kept
// separate from vite.config.ts (the Tauri build config) so the two don't tangle.
// Mirrors nview's test block. Add a jsdom environment here if component tests
// are wanted later.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
