# When ntune reads nothing from the relays on macOS (and the app is fine)

**Symptom.** Every list looks unpublished. Stations reads `publish all (N)` for the
whole local list, Podcasts reads `follow all (N)` for every subscription, and the
Stations header says `N local · saved on this device` — the string that only appears
when `relayStations` is **empty**. Meanwhile the events are demonstrably on the
relays, and the same build works on Linux.

**Cause (2026-08-20).** A per-connection network filter — this machine runs **both**
Little Snitch and LuLu — had not approved the webview's traffic. Nothing in ntune is
at fault.

## Why it is easy to misdiagnose

**Rust and the webview are different processes to a filter.** Publishing, feed
fetches and the ICY probe run in the Rust process; the relay *read* runs in the
webview, whose sockets belong to `com.apple.WebKit.Networking`, a separate helper.
Approving one says nothing about the other, so the app can fetch every podcast feed
and publish events successfully while reading nothing from a relay.

**`lsof` on the app's own pid proves nothing.** WKWebView holds no sockets in the
ntune process. Checking there shows zero connections and invites the conclusion that
the app never connected — which is how this investigation went wrong for an hour.
Check the helper instead:

```bash
pgrep -lf "WebKit.Networking"                    # find the helper next to ntune's pid
lsof -nP -i -a -p <helper-pid> | grep ESTABLISHED
```

**It survives a rebuild for the wrong reason, then breaks.** `install.sh` produces an
**ad-hoc, linker-signed** bundle (`codesign -dv` shows `flags=0x20002(adhoc,
linker-signed)`), so *every build is a new code identity*. A filter keying rules on
code signature treats each install as a different application: approve it once, and
the next `install.sh` silently loses the approval. The failure therefore looks
temporally correlated with whatever code landed in between — it is not.

**LuLu with no rule alerts rather than denies.** An alert behind other windows or on
another Space leaves the connection pending indefinitely, which reads as a hang, not
a block. Little Snitch with an existing *deny* rule is worse: no prompt at all.

## Isolating it in five minutes

Run these in order; the first one that fails localises the problem.

1. **Do the relays have the events?** `nak req -k 31241 -a <pk> --limit 60 wss://relay.fizx.uk`
   — use command substitution, never `timeout … > file` (see the empty-read note in
   STATUS).
2. **Does the resolver handle the real stream?** Capture the events and run them
   through `resolveStations` / `resolveShows` in a scratch vitest. On a 3,578-event
   stream (mostly other apps' `kind:5`) this took **10 ms**, and the incremental
   path 487 ms — so a slow resolve is not a plausible cause.
3. **Does the same frontend work in a normal browser?** `npm run tauri dev` serves it
   at `http://localhost:1420`; open that in Chrome. Tauri `invoke` calls fail there
   (expected, they log `Cannot read properties of undefined (reading 'invoke')`) but
   the relay read is pure web code and renders — the header shows
   `0 local · +N station.v1` when it works.
4. **Does WebKit itself work?** Open a `wss://` test page in **Safari** — same engine
   as the webview. If Safari connects and the app does not, the difference is the
   app's process, not the engine.
5. **Is the app actually connected?** The `lsof` on the WebKit helper above. If it
   shows ESTABLISHED sockets to the relay IPs, the transport is fine and the fault is
   above it.

## The fix

Approve ntune's webview traffic in whichever filter is blocking it, and prefer a
**path-scoped** rule (`/Applications/ntune.app`) over a signature-scoped one, or the
approval dies on the next rebuild. Check both filters — one allowing does not stop
the other denying.

Reading the filters' own state needs privileges, so it is an operator step:
LuLu's rules live at `/Library/Objective-See/LuLu/rules.plist` (readable; **no**
entry for ntune or the WebKit helper means it is prompting), and Little Snitch's
`littlesnitch log-traffic` / `export-model` need `sudo`.

## Not the cause, though each looked plausible

- The relays: all three served the events throughout, under the app's exact filter.
- The deletion backlog: the account carries **3,559 `kind:5` events** (mostly ndisc's
  release retractions, `k=31237`) against 19 useful ones, so the subscription is
  genuinely wasteful — but `nostr-tools` read all 3,580 in about a second, and the
  resolver handled them in 10 ms. Worth fixing for its own sake; it was not this.
- App Transport Security or entitlements: the bundle sets
  `NSAllowsArbitraryLoads = true`, is unsandboxed, and holds no entitlements.
- WebKit: Safari opened all four relays (three suite + one control) with events and
  EOSE.
