// How far one device and the relays have converged, counted over a list of rows.
// Neutral ground: podcasts (lib/show.ts) and stations (lib/station.ts) both report
// the same shape from their own row types, so the two tabs cannot drift into
// describing the same situation differently — which is exactly what happened
// before, when Podcasts said "10 subscribed · 26 published" and Stations said
// "9 local · +11 station.v1" about the identical three-way state.

/** The two gaps are the useful part: `notHere` is what another machine published
 *  and this one has not taken in, `notPublished` is what this machine holds and has
 *  never shared. Both zero is the finish line.
 *
 *  `inSync` is a claim about THIS device only, and deliberately so: it says
 *  everything here is published and everything published is here. It cannot say
 *  whether the other machine has caught up — that machine is in sync when it says
 *  so itself. Nothing in a relay read reveals what someone else's local store
 *  holds, so the honest scope is the one that can be measured. */
export interface SyncCounts {
  total: number;
  here: number;
  published: number;
  notHere: number;
  notPublished: number;
  inSync: boolean;
}

/** One row's standing, reduced to the two questions that matter. `ghost` marks a
 *  row the UI is holding open after a retraction (see FollowRow.ghost): a
 *  tombstone, counted nowhere — including, crucially, not as an unclosed gap, or
 *  `inSync` could never come back after a deliberate removal. */
export interface SyncRow {
  here: boolean;
  published: boolean;
  ghost?: boolean;
}

export function countSync(rows: SyncRow[]): SyncCounts {
  let total = 0;
  let here = 0;
  let published = 0;
  let notHere = 0;
  let notPublished = 0;
  for (const row of rows) {
    if (row.ghost) continue;
    total++;
    if (row.here) here++;
    if (row.published) published++;
    if (!row.here) notHere++;
    if (!row.published) notPublished++;
  }
  return {
    total,
    here,
    published,
    notHere,
    notPublished,
    // An empty list is not "in sync", it is empty — claiming convergence over
    // nothing reads as an answer when no question has been asked yet.
    inSync: total > 0 && notHere === 0 && notPublished === 0,
  };
}
