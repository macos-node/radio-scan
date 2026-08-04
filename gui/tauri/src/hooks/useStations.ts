import { useEffect, useRef, useState } from "react";
import { SimplePool, type Event as NostrEvent } from "nostr-tools";
import {
  DELETE_KIND,
  STATION_KIND,
  resolveStations,
  type Station,
} from "../lib/station";

// The tuner is a READ-ONLY consumer of station.v1 in U1 — no identity, no
// publishing yet (that is U2). Fixed relay set, the suite default with
// relay.fizx.uk as the discovery hub (same set nplay uses). A relay-config UI
// comes later. Transport only; the parse + dedupe maths is lib/station.ts.
const RELAYS = [
  "wss://relay.fizx.uk",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

export interface StationsState {
  stations: Station[];
  loading: boolean;
}

/** Subscribe to `ownerHex`'s kind:31241 stations (+ kind:5 deletes) and resolve
 *  them into the displayable list. `active` gates the subscription so relays are
 *  only touched while the tuner is mounted. Returns [] until events arrive —
 *  the caller falls back to the seed list when empty. */
export function useStations(
  ownerHex: string | undefined,
  active: boolean,
): StationsState {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const byKeyRef = useRef<Map<string, NostrEvent>>(new Map());

  useEffect(() => {
    if (!active || !ownerHex) {
      setLoading(false);
      return;
    }
    byKeyRef.current = new Map();
    setStations([]);
    setLoading(true);

    const pool = new SimplePool();
    const byKey = byKeyRef.current;
    const recompute = () =>
      setStations(resolveStations([...byKey.values()], ownerHex));

    const sub = pool.subscribeMany(
      RELAYS,
      { kinds: [STATION_KIND, DELETE_KIND], authors: [ownerHex] },
      {
        onevent(ev) {
          // Replaceable stations key by address; kind:5 deletes by id.
          const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
          const key =
            ev.kind === STATION_KIND
              ? `${ev.kind}:${ev.pubkey}:${dTag ?? ""}`
              : ev.id;
          const prev = byKey.get(key);
          if (!prev || ev.created_at > prev.created_at) {
            byKey.set(key, ev);
            recompute();
          }
        },
        oneose() {
          setLoading(false);
        },
      },
    );

    // Stop the spinner even if no relay answers.
    const t = setTimeout(() => setLoading(false), 5000);

    return () => {
      clearTimeout(t);
      sub.close();
      pool.close(RELAYS);
    };
  }, [ownerHex, active]);

  return { stations, loading };
}
