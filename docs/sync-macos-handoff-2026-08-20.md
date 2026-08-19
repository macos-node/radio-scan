# Decision #11 on macOS — build, publish, follow (2026-08-20)

Linux built steps 1–3 and has published its whole list. macOS needs to run the same
build and contribute its own. Everything here is shared TS/Rust — there is nothing
macOS-specific to write — so this is a pull, a build, and two buttons, plus the
checks that tell you it worked.

## State as of this note

```
stations published : 9   (Linux's 10 local rows — see "one stream, one event")
shows published    : 2   (macOS published both earlier)
relays             : relay.fizx.uk, nos.lol, relay.primal.net — all three carry all of it
```

## 1. Pull and build

```bash
cd ~/code_gh/macos-node/radio-scan && git pull
cd gui/tauri && make check && make install
```

`make check` runs the conformance gate. **If `canonicalization_matches_the_pinned_vectors`
or the TS `canonicalUrl` suite fails, stop** — that means macOS canonicalises URLs
differently from Linux, and publishing anything would mint a second address for a
stream that already has one. There are now four implementations held to
`schema/station-address.vectors.json` (Rust, the Python reference, macOS's own, and
`gui/tauri/src/lib/address.ts`); they agree today and the gate is what keeps them
agreeing.

## 2. Publish what macOS holds

Stations tab → **publish all (N)**. Podcasts tab → **follow all (N)**. Both:

- appear only when signed in and only when something local is unshared;
- send one item at a time with a pause — an unpaced burst is the shape relays refuse,
  measured on this machine's own 31-feed read sweep;
- never re-publish a row that arrived FROM the relays (`relayOnly`), because a device
  publishes what a person did on it;
- report `published 7, 2 failed` rather than finishing silently.

Expect macOS's 6 stations and 25 subscriptions to mostly be *new* addresses, and any
overlap with Linux's list to land on the **same** address and simply replace it —
that is the decision working, not a collision.

## 3. Check it worked

```bash
PK=916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d
for r in wss://relay.fizx.uk wss://nos.lol wss://relay.primal.net; do
  echo -n "$r stations: "; nak req -k 31241 -a $PK "$r" | wc -l
  echo -n "$r shows:    "; nak req -k 31242 -a $PK "$r" | wc -l
done
```

Then in the app: no **"published twice"** banner above the lists. That banner is the
step-2 duplicate detector; if it appears, a device is on an older build and its
publishes are landing at stale addresses — read it before publishing anything else.

> **`relay.fizx.uk` reads flap.** It went silent for 27 consecutive queries on
> 2026-08-19 and answered normally minutes either side, while accepting writes
> throughout. A zero from it is not evidence on its own — re-query, and check a kind
> you know is populated as a control before concluding anything.

## One stream, one event — expect the counts to disagree

Linux has **10** local stations and published **9**. That is correct: `drone-zone`
and `dronezone` are the same SomaFM mount over https and http, so they canonicalise
to one address, `da24be21dc42b8e2`, and one event.

This surfaced a bug fixed in the same commit as this note: the station merge matched
local rows to published events by **raw URL**, so the row whose scheme didn't match
the published `r` looked permanently unpublished, and pressing `publish all` would
have flipped which of the two appeared published, forever. The merge now keys on the
canonical URL, which is also why the list shows 9 rows rather than 10 — the duplicate
collapses on display.

**The local store still holds both rows.** Nothing removes them automatically; ✕ is
device-local now, so deleting the redundant one is safe and affects nothing on the
wire. Left to the operator rather than done silently.

## What is NOT done

- **A device still cannot see another device's local-only items until someone
  presses publish.** That is by design (nothing publishes unasked), but it means
  "totality" is a habit, not a guarantee.
- **Deletion still relies on `kind:5`**, with the reliability caveat measured on
  2026-08-19 — `relay.fizx.uk` honours deletion by event id, not by address. The
  NIP-51 alternative was considered and rejected in the decision doc; revisit only if
  per-item events prove noisy.
- **Stations have no publisher-stated identity**, so a mount that moves host
  re-addresses and needs a manual re-publish. Shows escape this via `podcast:guid`.
