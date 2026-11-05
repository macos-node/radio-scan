// The suite relay set: our own `relay.nfunc.xyz`, now the only default. Shared
// by the read subscription (useStations) and the publish calls
// (publish_station), so the list you read from and the list you write to never
// drift apart.
//
// It is whitelist-only: a key that is not allowed on it publishes nowhere.
// nos.lol and relay.primal.net were dropped 2026-10-03 to match ndisc and nplay;
// relay.fizx.uk went when the fizx.uk server was decommissioned.
export const RELAYS = ["wss://relay.nfunc.xyz"];
