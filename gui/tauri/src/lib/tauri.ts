// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
//
// U0 scope: radio streams play webview-side via a plain <audio> element on the
// remote HTTP URL — WebKit2GTK plays *remote* media fine (the asset-protocol
// limitation nplay hit is only for *local* files), so no Rust audio command is
// needed yet. The one command here just seeds a starter station list; from U1
// the list comes from `station.v1` (31241) events off the relays instead.

import { invoke } from "@tauri-apps/api/core";

/** A tunable stream. Mirrors the `station.v1` shape (schema/station.v1.json) so
 *  U1 can swap the seed source for relay events without changing this type:
 *  `slug`→`d` suffix, `url`→`r` tag, `fmt`/`bitrate`→`fmt`/`br` tags. */
export interface Station {
  /** Stable id — the `airplay:station:<slug>` identity from station.v1. */
  slug: string;
  name: string;
  /** Stream URL (the relay-filterable `r` tag in station.v1). */
  url: string;
  /** Advertised container/codec, e.g. "audio/mpeg". Optional. */
  fmt: string | null;
  /** Advertised bitrate in kbps. Optional. */
  bitrate: number | null;
  /** Freeform tags (genre) — the `t` tags in station.v1. */
  tags: string[];
}

/** Starter stations, served from Rust so the IPC round-trip is exercised from
 *  day one. Replaced in U1 by a relay read of the user's followed station.v1s. */
export function seedStations(): Promise<Station[]> {
  return invoke<Station[]>("seed_stations");
}
