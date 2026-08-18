// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
//
// Radio plays webview-side in an <audio> element, but through a Rust loopback
// proxy (src-tauri/src/proxy.rs): a packaged app's secure origin (tauri://…)
// blocks a plain http:// stream as mixed content, so we play the stream via
// http://127.0.0.1:<port> instead (see getProxyPort / streamUrl). Rust also owns
// the seed fallback (U0) + nostr identity and station.v1 publishing (U2); the
// nsec never leaves Rust except once on generate.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Station } from "./station";
import { RELAYS } from "./relays";

export type { Station };

// --- clipboard + JSON import/export (stations / podcasts) -------------------

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

/** Prompt for a JSON file with a native Open dialog, read + parse it. Returns
 *  the parsed value, or null if the user cancelled. Throws on read / parse
 *  failure (invalid JSON) — the caller surfaces the message. */
export async function importJson<T = unknown>(): Promise<T | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null; // cancelled
  const text = await invoke<string>("read_text_file", { path });
  return JSON.parse(text) as T;
}

/** The shared now-playing bridge payload (frozen contract:
 *  docs/nowplaying-bridge-2026-08-11.md). airplay.v1-adjacent — `r` is the
 *  stream/enclosure URL (the join key a consumer matches to `*_log.audio_url`). */
export interface NowPlayingState {
  kind: "station" | "episode";
  key: string;
  r: string;
  title: string;
  subtitle?: string;
  artist?: string; // live ICY, station only
  track?: string; // live ICY, station only
  playing: boolean;
  ts: number; // unix seconds
}

/** Write the shared now-playing state to
 *  `<local_data_dir()>/radio-scan/nowplaying.json` (local-only; the menubar/tray
 *  reads it). Best-effort — a failed write never disrupts playback. */
export function writeNowPlaying(state: NowPlayingState): Promise<void> {
  return invoke("write_nowplaying", { state });
}

/** Save arbitrary text to a chosen path (native Save dialog). `ext` sets the
 *  filter + default extension (e.g. "opml"). Same `export_file` command as
 *  exportJson, just without the JSON.stringify. */
export async function exportText(
  defaultName: string,
  contents: string,
  ext: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return null; // cancelled
  await invoke("export_file", { path, contents });
  return path;
}

/** Open a subscriptions file (OPML or JSON) and return its raw text + path, so
 *  the caller can parse either format (podcasts import accepts both). Reuses the
 *  same `read_text_file` command as importJson — no new Rust needed. */
export async function openImportFile(): Promise<{ path: string; text: string } | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Subscriptions (OPML or JSON)", extensions: ["opml", "xml", "json"] }],
  });
  if (typeof path !== "string") return null; // cancelled
  const text = await invoke<string>("read_text_file", { path });
  return { path, text };
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
  description?: string | null;
}): Promise<Station> {
  return invoke<Station>("add_local_station", {
    slug: input.slug,
    name: input.name,
    url: input.url,
    fmt: input.fmt ?? null,
    bitrate: input.bitrate ?? null,
    tags: input.tags,
    description: input.description ?? null,
  });
}

/** Remove a local station by slug. Idempotent. */
export function removeLocalStation(slug: string): Promise<void> {
  return invoke("remove_local_station", { slug });
}

/** Merge imported stations into the local store; returns the full merged list
 *  (deduped by slug + url, imported entries first). Each must have at least
 *  slug/name/url — descriptive fields default. */
export function importLocalStations(stations: Station[]): Promise<Station[]> {
  return invoke<Station[]>("import_local_stations", { stations });
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
  /** Cover-art URL — stored/surfaced, but rendering deferred (U4 decision). */
  image: string | null;
  // Tier-A harvest — channel-level show identity, feed-authoritative. Enrichment
  // fills only whichever of these the feed left empty; it never overrides them.
  author: string | null;
  ownerEmail: string | null;
  website: string | null;
  categories: string[];
  language: string | null;
  copyright: string | null;
  /** `<podcast:guid>` — the Podcasting-2.0 channel GUID: the show's identity
   *  independent of the URL serving it. Absent on plenty of feeds. */
  guid: string | null;
  episodes: Episode[];
}

/** Fetch + parse a podcast feed URL into episodes. Writes through the on-disk
 *  feed cache, and sends the cached ETag / Last-Modified as a conditional GET —
 *  an unchanged feed answers 304 and costs no body and no reparse. */
export function fetchPodcast(url: string): Promise<Podcast> {
  return invoke<Podcast>("fetch_podcast", { url });
}

/** One feed as last stored on disk: the parsed body plus when it was last
 *  confirmed current. */
export interface CachedFeed {
  url: string;
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
  podcast: Podcast;
}

/** Cached bodies for the given feed URLs — a local disk read, so the Podcasts
 *  tab can paint immediately instead of waiting on the network. Feeds with no
 *  cache entry are simply absent from the result. */
export function cachedPodcasts(urls: string[]): Promise<CachedFeed[]> {
  return invoke<CachedFeed[]>("cached_podcasts", { urls });
}

/** Static ICY headers a stream advertises — captured on tune-in to enrich a
 *  station (win #2). All optional; a plain file or a non-ICY server yields nulls. */
export interface IcyInfo {
  name: string | null;
  genre: string | null;
  bitrate: number | null;
  homepage: string | null;
  fmt: string | null;
}

/** Probe a stream's ICY headers without playing it (header-only read). */
export function stationIcy(url: string): Promise<IcyInfo> {
  return invoke<IcyInfo>("station_icy", { url });
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

/** Unfollow a station — publish a kind:5 deletion of its `station.v1`.
 *
 *  Pass `eventId` (the id of the kind:31241 event being deleted) whenever the row
 *  came from a relay: NIP-09 lets a deletion name both the addressable `a`
 *  coordinate and the concrete `e` id, and several relay implementations only
 *  honour deletion **by event id**. Measured 2026-08-18 on the suite's own hub —
 *  `relay.fizx.uk` accepted a-only deletions and kept serving every tombstoned
 *  station; nos.lol dropped them. Clients that filter deletions themselves (ntune
 *  does) were fine either way; anything trusting the relay was not. */
export function unfollowStation(
  slug: string,
  eventId?: string,
): Promise<PublishResult> {
  return invoke<PublishResult>("unfollow_station", { slug, eventId, relays: RELAYS });
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
