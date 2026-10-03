// The suite relay set: the hub (`relay.fizx.uk`) and its mirror
// (`relay.nfunc.xyz`), both our own. Shared by the read subscription
// (useStations) and the publish calls (publish_station), so the list you read
// from and the list you write to never drift apart.
//
// Both are whitelist-only: a key that is not allowed on them publishes nowhere.
// nos.lol and relay.primal.net were dropped 2026-10-03 to match ndisc and nplay.
export const RELAYS = [
  "wss://relay.fizx.uk",
  "wss://relay.nfunc.xyz",
];
