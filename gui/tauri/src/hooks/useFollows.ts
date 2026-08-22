import { useCallback, useEffect, useRef, useState } from "react";
import { SimplePool, type Event as NostrEvent } from "nostr-tools";
import {
  DELETE_KIND,
  STATION_KIND,
  resolveStations,
  type Station,
} from "../lib/station";
import { SHOW_KIND, resolveShows, type Show } from "../lib/show";
import { ingestEvent, supersededAddresses } from "../lib/addressable";
import { RELAYS } from "../lib/relays";

/** The kinds that collapse by address rather than by event id. */
const ADDRESSABLE = [STATION_KIND, SHOW_KIND];

export interface FollowsState {
  stations: Station[];
  shows: Show[];
  loading: boolean;
  /** Addresses holding a follow that something else has since republished under a
   *  different `d` — the signature of a device on a build older than the contract
   *  (decision #11). Maps the superseded address to the target it duplicates. One
   *  target must have exactly one address, so a non-empty map is always wrong and
   *  always worth showing. */
  superseded: Map<string, string>;
  /** Has ANY relay actually answered — an event, or an EOSE saying "nothing"?
   *
   *  The question `loading` cannot answer. `loading` is cleared by a 5 s timeout
   *  precisely so a silent relay does not hang the spinner, so a machine that
   *  reached nobody looks exactly like one whose relays serve nothing: both end
   *  up `loading: false` with empty lists. Downstream that difference is the
   *  difference between "you have published nothing" and "we have not asked
   *  anyone yet", and one of those must not put a publish-everything button on
   *  screen. Measured 2026-08-22: two of three sockets died over ten hours with
   *  nothing reconnecting them, which is how a running app arrives at silence. */
  answered: boolean;
  /** Re-read the published lists NOW, folding anything new into the live map.
   *
   *  Call it after publishing: a follow published mid-session did not mark its own
   *  row, because `follow()` keeps no local state and waits for the open
   *  subscription to hand the event back — and a subscription that has been idle
   *  since EOSE does not always deliver (measured on macOS 2026-08-19, chip stayed
   *  `follow` until restart). This keeps the rule that the chip reflects the RELAY,
   *  not the click: it re-asks rather than assuming the publish worked. */
  refresh: () => void;
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
  const [superseded, setSuperseded] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState(false);
  const byKeyRef = useRef<Map<string, NostrEvent>>(new Map());
  // Set while the subscription is live; a no-op before mount and after teardown,
  // so a late `refresh()` from an in-flight publish cannot touch a closed pool.
  const refetchRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refetchRef.current(), []);

  useEffect(() => {
    if (!active || !ownerHex) {
      setLoading(false);
      return;
    }
    byKeyRef.current = new Map();
    setStations([]);
    setShows([]);
    setSuperseded(new Map());
    setLoading(true);
    setAnswered(false);

    const pool = new SimplePool();
    const byKey = byKeyRef.current;
    const filter = {
      kinds: [STATION_KIND, SHOW_KIND, DELETE_KIND],
      authors: [ownerHex],
    };
    const recompute = () => {
      const evs = [...byKey.values()];
      setStations(resolveStations(evs, ownerHex));
      setShows(resolveShows(evs, ownerHex));
      // Detect duplicates across BOTH kinds in one map: a stale publisher produces
      // the same shape whichever list it touched.
      const dupes = new Map([
        ...supersededAddresses(evs, STATION_KIND, ownerHex),
        ...supersededAddresses(evs, SHOW_KIND, ownerHex),
      ]);
      setSuperseded(dupes);
    };

    const sub = pool.subscribeMany(RELAYS, filter, {
      onevent(ev) {
        setAnswered(true);
        if (ingestEvent(byKey, ev, ADDRESSABLE)) recompute();
      },
      oneose() {
        // EOSE is an answer: "nothing here" is a reading, silence is not.
        setAnswered(true);
        setLoading(false);
      },
    });

    // A one-shot re-read on the same pool. Deliberately additive: it folds into the
    // same map the subscription writes, so a refetch never blanks the list.
    refetchRef.current = () => {
      pool
        .querySync(RELAYS, filter)
        .then((evs) => {
          let changed = false;
          for (const ev of evs) {
            if (ingestEvent(byKey, ev, ADDRESSABLE)) changed = true;
          }
          setAnswered(true);
          if (changed) recompute();
        })
        .catch((e) => console.error("follows refresh failed", e));
    };

    // Stop the spinner even if no relay answers.
    const t = setTimeout(() => setLoading(false), 5000);

    return () => {
      clearTimeout(t);
      refetchRef.current = () => {};
      sub.close();
      pool.close(RELAYS);
    };
  }, [ownerHex, active]);

  return { stations, shows, loading, answered, superseded, refresh };
}
