// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
//
// Radio streams play webview-side via a plain <audio> element on the remote
// HTTP URL — WebKit2GTK plays *remote* media fine (the asset-protocol
// limitation nplay hit is only for *local* files), so no Rust audio command is
// needed. Rust owns the seed fallback (U0) + nostr identity and station.v1
// publishing (U2). The nsec never leaves Rust except once on generate.

import { invoke } from "@tauri-apps/api/core";
import type { Station } from "./station";
import { RELAYS } from "./relays";

export type { Station };

/** Starter stations, served from Rust so the IPC round-trip is exercised. The
 *  fallback shown until the user's followed `station.v1` (31241) events are read
 *  off the relays (see hooks/useStations.ts). */
export function seedStations(): Promise<Station[]> {
  return invoke<Station[]>("seed_stations");
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
