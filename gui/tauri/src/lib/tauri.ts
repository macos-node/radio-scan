// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
//
// Radio streams play webview-side via a plain <audio> element on the remote
// HTTP URL — WebKit2GTK plays *remote* media fine (the asset-protocol
// limitation nplay hit is only for *local* files), so no Rust audio command is
// needed. The one command here seeds a starter station list, used as the
// first-run fallback when the relays return no `station.v1` events (U1).

import { invoke } from "@tauri-apps/api/core";
import type { Station } from "./station";

export type { Station };

/** Starter stations, served from Rust so the IPC round-trip is exercised. The
 *  fallback shown until the user's followed `station.v1` (31241) events are read
 *  off the relays (see hooks/useStations.ts). */
export function seedStations(): Promise<Station[]> {
  return invoke<Station[]>("seed_stations");
}
