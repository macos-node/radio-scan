// The suite relay set — `relay.fizx.uk` is the discovery hub. Shared by the
// read subscription (useStations) and the publish calls (publish_station), so
// the list you read from and the list you write to never drift apart.
export const RELAYS = [
  "wss://relay.fizx.uk",
  "wss://nos.lol",
  "wss://relay.primal.net",
];
