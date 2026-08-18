import { useEffect, useRef, useState } from "react";
import { SimplePool, type Event as NostrEvent } from "nostr-tools";
import {
  DELETE_KIND,
  STATION_KIND,
  resolveStations,
  type Station,
} from "../lib/station";
import { SHOW_KIND, resolveShows, type Show } from "../lib/show";
import { RELAYS } from "../lib/relays";

export interface FollowsState {
  stations: Station[];
  shows: Show[];
  loading: boolean;
}

/** Subscribe to `ownerHex`'s published follows — kind:31241 stations and
 *  kind:31242 shows, plus the kind:5 deletes that void them — and resolve each
 *  into its displayable list.
 *
 *  ONE subscription covers both kinds: they share an author, a relay set and the
 *  deletion stream, so a second pool would duplicate every kind:5 for nothing.
 *  `active` gates it so relays are only touched while the app is mounted. Each
 *  list is [] until events arrive; the caller falls back to its local store. */
export function useFollows(
  ownerHex: string | undefined,
  active: boolean,
): FollowsState {
  const [stations, setStations] = useState<Station[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const byKeyRef = useRef<Map<string, NostrEvent>>(new Map());

  useEffect(() => {
    if (!active || !ownerHex) {
      setLoading(false);
      return;
    }
    byKeyRef.current = new Map();
    setStations([]);
    setShows([]);
    setLoading(true);

    const pool = new SimplePool();
    const byKey = byKeyRef.current;
    const recompute = () => {
      const evs = [...byKey.values()];
      setStations(resolveStations(evs, ownerHex));
      setShows(resolveShows(evs, ownerHex));
    };

    const sub = pool.subscribeMany(
      RELAYS,
      { kinds: [STATION_KIND, SHOW_KIND, DELETE_KIND], authors: [ownerHex] },
      {
        onevent(ev) {
          // Replaceable follows key by address; kind:5 deletes by id.
          const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
          const key =
            ev.kind === STATION_KIND || ev.kind === SHOW_KIND
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

  return { stations, shows, loading };
}
