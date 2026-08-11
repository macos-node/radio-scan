// Durable UI-preference store (theme, volume, list/card views). Prefs persist in
// Rust (settings.json, a synchronous std::fs::write next to stations.json) so they
// survive ANY exit — the webview localStorage they used to live in only flushes on
// a graceful window-close, the same durability gap that lost podcasts
// (docs/podcast-persistence-2026-08-11.md). localStorage is kept as a mirror: the
// index.html pre-paint theme read needs a synchronous source, and it's the
// pre-init / private-mode fallback. The Rust store is authoritative on load.

import { invoke } from "@tauri-apps/api/core";

export const THEME_KEY = "ntune.theme";
export const VOLUME_KEY = "ntune.volume";
export const STATION_VIEW_KEY = "ntune.stationView";
export const PODCAST_VIEW_KEY = "ntune.podcastView";

/** The prefs migrated from localStorage on the first launch after this store. */
const MIGRATE_KEYS = [THEME_KEY, VOLUME_KEY, STATION_VIEW_KEY, PODCAST_VIEW_KEY];

/** Dispatched after initSettings() loads the durable store, so mounted components
 *  re-read the now-authoritative values (same-document localStorage writes don't
 *  fire `storage`). */
export const SETTINGS_EVENT = "ntune:settings-changed";

let cache: Record<string, string> = {};
let ready = false;

/** A setting's value, or null if unset. Returns the durable cache once
 *  initSettings() has run; before that (and as a fallback) the localStorage
 *  mirror — so it behaves exactly like the old `localStorage.getItem`. */
export function getSetting(key: string): string | null {
  if (ready) return key in cache ? cache[key] : null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Persist a setting to the durable Rust store AND mirror to localStorage. The
 *  Rust write hits disk synchronously, so nothing is lost on a non-graceful exit. */
export function setSetting(key: string, value: string): void {
  cache[key] = value;
  try {
    localStorage.setItem(key, value); // mirror: pre-paint read + fallback
  } catch {
    /* private mode — Rust write below still persists it */
  }
  void invoke("set_setting", { key, value }).catch((e) =>
    console.error("set_setting failed", e),
  );
}

/** Load the durable store once at startup, migrating known localStorage prefs on
 *  the first launch after it landed, then correcting the localStorage mirror to
 *  match. Dispatches SETTINGS_EVENT so components re-read the authoritative value. */
export async function initSettings(): Promise<void> {
  let stored: Record<string, string> = {};
  try {
    stored = await invoke<Record<string, string>>("get_settings");
  } catch (e) {
    console.error("get_settings failed", e);
  }
  cache = { ...stored };
  for (const k of MIGRATE_KEYS) {
    if (!(k in cache)) {
      let v: string | null = null;
      try {
        v = localStorage.getItem(k);
      } catch {
        /* ignore */
      }
      if (v != null) {
        cache[k] = v;
        void invoke("set_setting", { key: k, value: v }).catch(() => {});
      }
    }
  }
  // Correct the mirror so the pre-paint read + any pre-init fallback are authoritative.
  try {
    for (const [k, v] of Object.entries(cache)) localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
  ready = true;
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}
