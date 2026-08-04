import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/ — tailored for Tauri dev, mirrors the suite (nplay).
export default defineConfig(async () => ({
  plugins: [react()],
  // Don't obscure Rust errors during `tauri dev`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Vite must not watch the Rust side.
      ignored: ["**/src-tauri/**"],
    },
  },
}));
