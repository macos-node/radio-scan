# ntune reads nothing from the relays on macOS — symptom, remedy, cause unknown

**Status: UNRESOLVED.** A VPN restored it. Why the direct path fails is *not*
established, and this note deliberately stops short of claiming it.

## Symptom

Every list looks unpublished. Stations reads `publish all (N)` for the whole local
list, Podcasts `follow all (N)` for every subscription, and the Stations header says
`N local · saved on this device` — the string that appears only when `relayStations`
is **empty**. Meanwhile the events are demonstrably on the relays and the same build
works on Linux.

## What restored it

**Connecting a VPN.** With the tunnel up, the reads worked immediately: `6 local ·
+9 station.v1`, correct `published` / `following` chips, and the publish-all counts
matching what had been computed by hand beforehand. That is the whole of the remedy
that has actually been demonstrated.

## What is established (each measured, so do not re-test)

- **The relays serve the events**, all three, under the app's exact filter —
  `{kinds:[31241,31242,5], authors:[<pk>]}`. `relay.primal.net` returns them in 30
  events total.
- **The resolver is fast and correct.** A captured 3,578-event stream through
  `resolveStations` / `resolveShows` gives 9 stations and 10 shows in **10 ms**; the
  incremental path — a recompute per event, as `useFollows` does — takes **487 ms**
  for the whole stream. A slow resolve is not a plausible cause.
- **`nostr-tools` reads it** outside the app: 3,580 events, first at ~1 s.
- **The same frontend works in a normal browser.** `npm run tauri dev` serves it at
  `http://localhost:1420`; in Chrome it renders `0 local · +9 station.v1`. Tauri
  `invoke` calls fail there (expected — `Cannot read properties of undefined (reading
  'invoke')`), but the relay read is pure web code.
- **WebKit itself works.** A `wss://` test page in Safari — same engine as the
  webview — opened all three suite relays plus a control, with events and EOSE.
- **The bundle is permissive**: unsandboxed, no entitlements, `NSAllowsArbitraryLoads
  = true`.
- **Rust networking is unaffected** throughout: feed fetches and publishes work while
  the webview reads nothing. Rust and the webview are different processes, and only
  the webview side ever failed.

## The measurement that misled, and the correct one

`lsof` on ntune's own pid shows **zero** sockets, because WKWebView holds none — its
traffic belongs to a `com.apple.WebKit.Networking` helper. Reading that as "the app
never connected" cost about an hour and produced three wrong theories. Check the
helper instead:

```bash
pgrep -lf "WebKit.Networking"                     # find the helper beside ntune's pid
lsof -nP -i -a -p <helper-pid> | grep ESTABLISHED
```

Doing that showed the app **was** connected to `relay.fizx.uk` while displaying
nothing — which is the real shape of the problem and remains unexplained.

## Suspected, never confirmed

This machine runs Little Snitch and LuLu, both per-connection filters, and
`install.sh` produces an **ad-hoc, linker-signed** bundle (`codesign -dv` →
`flags=0x20002(adhoc,linker-signed)`), so every rebuild is a new code identity that
signature-scoped rules would not match. That would fit "worked last night, silently
stopped tonight" with no code change to explain it.

**But no filter was ever observed denying anything.** LuLu holds no rule for ntune or
the WebKit helper — which means it would *prompt*, not block — and Little Snitch's
traffic log needs `sudo` and was never read. Treat this as a hypothesis with a
plausible mechanism and no evidence, not as the answer.

## If picking this up again

1. Reproduce without the VPN, then read Little Snitch's log: `sudo littlesnitch
   log-traffic | grep -i ntune`. That is the one check that would settle the
   filter hypothesis either way, and it was never run.
2. Attach a devtools console to the packaged webview and watch what the subscription
   actually does — whether the REQ goes out, whether events arrive and rendering
   fails, or nothing arrives at all. Everything so far has been inferred from
   outside the process.
3. If a filter *is* implicated, prefer a **path-scoped** rule over a signature-scoped
   one, or the approval dies at the next `install.sh`.
