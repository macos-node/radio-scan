// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
//
// Radio plays webview-side in an <audio> element, but through a Rust loopback
// proxy (src-tauri/src/proxy.rs): a packaged app's secure origin (tauri://…)
// blocks a plain http:// stream as mixed content, so we play the stream via
// http://127.0.0.1:<port> instead (see getProxyPort / streamUrl). Rust also owns
// the seed fallback (U0) + nostr identity and station.v1 publishing (U2); the
// nsec never leaves Rust except once on generate.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import type { Station } from "./station";
import { RELAYS } from "./relays";

export type { Station };

// --- clipboard + JSON export (stations / podcasts) --------------------------

/** Copy text (a stream / feed URL) to the OS clipboard. */
export function copyText(text: string): Promise<void> {
  return writeText(text);
}

/** Prompt for a location with a native Save dialog and write `data` as pretty
 *  JSON there. Returns the chosen path, or null if the user cancelled. */
export async function exportJson(
  defaultName: string,
  data: unknown,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null; // cancelled
  await invoke("export_file", {
    path,
    contents: JSON.stringify(data, null, 2),
  });
  return path;
}

// --- loopback stream proxy ---------------------------------------------------

/** The loopback proxy's port for this run (src-tauri/src/proxy.rs). */
export function getProxyPort(): Promise<number> {
  return invoke<number>("proxy_port");
}

/** A now-playing update the proxy parsed from the stream's ICY metadata (U3).
 *  `url` is the upstream, so the UI can ignore events for a station it left. */
export interface NowPlaying {
  url: string;
  title: string;
  artist: string;
}

/** Subscribe to `now-playing` events emitted by the ICY proxy. Returns the
 *  unlisten fn. */
export function onNowPlaying(
  cb: (np: NowPlaying) => void,
): Promise<UnlistenFn> {
  return listen<NowPlaying>("now-playing", (e) => cb(e.payload));
}

/** The URL the <audio> element should load for an upstream stream: a loopback
 *  origin, so a secure-origin (packaged) build isn't blocked by mixed content
 *  when the stream is plain http://. */
export function streamUrl(port: number, upstream: string): string {
  return `http://127.0.0.1:${port}/?url=${encodeURIComponent(upstream)}`;
}

// --- tray / menubar companion (U6) ------------------------------------------

/** Subscribe to the tray's "Favorite current track" menu action (U6, `--tray`).
 *  The tray knows only artist/title from now-playing, so it hands the click to
 *  the UI — which holds the station's display name — to run the same favorite
 *  toggle as the in-window heart. Returns the unlisten fn. */
export function onTrayFavorite(cb: () => void): Promise<UnlistenFn> {
  return listen("tray-favorite", () => cb());
}

/** Push the derived now-playing state to the tray (U6, `--tray`). The UI is the
 *  single source of truth — it already clears now-playing on stop and gates the
 *  ♥ — so the tray's label + ♥-enabled mirror it exactly. A no-op when the app
 *  was launched without a tray (nothing listens). */
export function emitTrayNowPlaying(state: {
  label: string;
  canFavorite: boolean;
}): Promise<void> {
  return emit("tray-now-playing", state);
}

/** Starter stations, served from Rust. The pristine seed set — on a fresh
 *  install these are copied into the local store (listLocalStations) as normal,
 *  removable rows. Kept exposed for tests / a "reset to seeds" affordance. */
export function seedStations(): Promise<Station[]> {
  return invoke<Station[]>("seed_stations");
}

// --- local station store (no Nostr key required) ----------------------------
// The always-available station list, persisted to stations.json in the app-data
// dir (Linux: ~/.local/share/<id>; macOS: ~/Library/Application Support/<id>).
// Adds land here immediately and survive restarts. Independent of the Nostr
// station.v1 layer (useStations.ts), which stays an optional overlay.

/** The persisted local stations. Seeds itself from the seed set on first run. */
export function listLocalStations(): Promise<Station[]> {
  return invoke<Station[]>("list_local_stations");
}

/** Save a stream to the local store (deduped by slug + url). No key needed. */
export function addLocalStation(input: {
  slug: string;
  name: string;
  url: string;
  fmt?: string | null;
  bitrate?: number | null;
  tags: string[];
}): Promise<Station> {
  return invoke<Station>("add_local_station", {
    slug: input.slug,
    name: input.name,
    url: input.url,
    fmt: input.fmt ?? null,
    bitrate: input.bitrate ?? null,
    tags: input.tags,
  });
}

/** Remove a local station by slug. Idempotent. */
export function removeLocalStation(slug: string): Promise<void> {
  return invoke("remove_local_station", { slug });
}

// --- podcast RSS (U4) --------------------------------------------------------

/** One podcast episode parsed from an RSS/Atom feed (Rust feed-rs). */
export interface Episode {
  id: string;
  title: string;
  enclosureUrl: string;
  mime: string | null;
  durationSecs: number | null;
  publishedAt: number | null;
}

/** A podcast feed + its episodes (newest first). */
export interface Podcast {
  title: string;
  description: string | null;
  image: string | null;
  episodes: Episode[];
}

/** Fetch + parse a podcast feed URL into episodes. */
export function fetchPodcast(url: string): Promise<Podcast> {
  return invoke<Podcast>("fetch_podcast", { url });
}

// --- nostr identity (OS keychain) -------------------------------------------

export interface Identity {
  npub: string;
  pk: string; // hex pubkey — the read filter + publish author
}

export interface GeneratedIdentity extends Identity {
  /** Returned ONCE on generate for backup; afterwards the nsec stays in the
   *  keychain and only npub/pk come back. */
  nsec: string;
}

/** The signed-in identity, or null when no nsec is stored. */
export function getIdentity(): Promise<Identity | null> {
  return invoke<Identity | null>("get_identity");
}

/** Generate a fresh keypair and store it. Returns the nsec once — back it up. */
export function generateIdentity(): Promise<GeneratedIdentity> {
  return invoke<GeneratedIdentity>("generate_identity");
}

/** Import an existing `nsec…` (the suite key — one npub per person). */
export function importIdentity(nsec: string): Promise<Identity> {
  return invoke<Identity>("import_identity", { nsec });
}

/** Forget the stored nsec (does not touch anything on the relays). */
export function clearIdentity(): Promise<void> {
  return invoke("clear_identity");
}

// --- station.v1 publish / unfollow (U2) -------------------------------------

export interface RelayError {
  relay: string;
  error: string;
}

export interface PublishResult {
  eventId: string;
  /** Addressable coordinate `31241:<pk>:<d>`. */
  address: string;
  acceptedBy: string[];
  rejected: RelayError[];
}

/** Fields a user supplies to follow a stream. `slug` is derived from the name
 *  (see slugify); re-publishing the same slug edits the station in place. */
export interface StationInput {
  slug: string;
  name: string;
  url: string;
  fmt?: string | null;
  bitrate?: number | null;
  tags: string[];
  description: string;
}

/** Follow / edit a station — sign & publish a `station.v1` to the suite relays. */
export function publishStation(input: StationInput): Promise<PublishResult> {
  return invoke<PublishResult>("publish_station", {
    slug: input.slug,
    name: input.name,
    url: input.url,
    fmt: input.fmt ?? null,
    bitrate: input.bitrate ?? null,
    tags: input.tags,
    description: input.description,
    relays: RELAYS,
  });
}

/** Unfollow a station — publish a kind:5 deletion of its `station.v1`. */
export function unfollowStation(slug: string): Promise<PublishResult> {
  return invoke<PublishResult>("unfollow_station", { slug, relays: RELAYS });
}

// --- favorites (local curated log) ------------------------------------------

/** A track you liked while listening (from U3's now-playing). Local-first v1. */
export interface Favorite {
  id: string;
  artist: string;
  title: string;
  station: string;
  url: string;
  ts: number; // epoch seconds
}

/** Save the current track as a favorite (appends to the local log). */
export function addFavorite(f: {
  artist: string;
  title: string;
  station: string;
  url: string;
}): Promise<Favorite> {
  return invoke<Favorite>("add_favorite", f);
}

/** All favorites, newest first. */
export function listFavorites(): Promise<Favorite[]> {
  return invoke<Favorite[]>("list_favorites");
}

/** Remove a favorite by id. */
export function removeFavorite(id: string): Promise<void> {
  return invoke("remove_favorite", { id });
}
