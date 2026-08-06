# ntune / suite — the mobile tier (iOS + Android): a thought, not a plan

> **Status: THOUGHT — parked, not scheduled, not accepted.** Captured so the idea
> survives and both sessions (Linux `adjmx` + macOS `macos-node`) share the same
> framing if it's ever picked up. Nothing here gates anything. Driven by **ntune**
> (the strongest mobile case) but the decision is **suite-wide** — if it's ever
> acted on, this graduates to [`../../SUITE.md`](../../SUITE.md) (the mobile stance
> lives there: *"Mobile = Capacitor (nview only)"*). Related: the L4 build map
> [`../../docs/radio-scan-ui-2026-08-04.md`](../../docs/radio-scan-ui-2026-08-04.md).

Date: 2026-08-05 · one-line: *the frontend is already universal; the mobile
question is only about the backend, and nview already answered it.*

---

## The reframe — we already ship to iOS + Android
This is **not** a green-field "can we go mobile." **nview** is a live Capacitor
app with real `ios/` + `android/` projects, React 19, `@capacitor/assets` icons,
`vite-plugin-pwa`, and NIP-46 signing. So the suite already builds for both
phones. The real question is narrower: **extend that mobile tier from the
read-only viewer to the *player* apps** (ntune first).

## The architecture we actually have — one half is already done
```
        ┌─────────────── shared React 19 + design tokens ───────────────┐
        │  UI layer — ALREADY UNIVERSAL (desktop Tauri + nview mobile)   │
        └───────────────▲───────────────────────────────▲───────────────┘
   desktop backend (Rust) │                              │ mobile backend (native)
   Tauri 2 · proxy.rs ICY │                              │ Capacitor · JS + plugins
   feed-rs · nostr-sdk    │                              │ nostr-tools · NIP-46 bunker
   keyring (secret-service/apple)                        │ NO Rust core, NO local keys
```
- **Frontend = universal already.** Desktop and nview both run **React 19 + the
  same tokens + lucide + Tailwind**. The UI ports; that half is effectively free.
- **Backend = the fork, and the whole cost.** Desktop apps put their value in
  **Rust** (ntune: `proxy.rs` loopback ICY, `feed-rs`, `nostr-sdk`, `keyring`).
  Capacitor has **no Rust core** — nview re-expresses its needs in JS + native
  plugins. Any app going mobile pays to rebuild its Rust half in that world.

## The one real decision
| Path | Reuse | Cost | Verdict |
|---|---|---|---|
| **A. Capacitor** (nview's path) | React UI; one mobile toolchain; signing already solved (bunker) | rebuild each app's Rust-backend features as JS / Capacitor plugins | **Recommended** — coherent with the suite |
| **B. Tauri 2 mobile** | carries the Rust core (proxy/feed-rs/nostr-sdk) onto phones | **forks the mobile story away from nview** → two mobile toolchains | only if the Rust core is too valuable to re-express |

Lean **A**. Favourable detail: ntune's [`../src/lib/tauri.ts`](../src/lib/tauri.ts)
is *already* a thin typed adapter — every backend call goes through ~15 wrappers.
A parallel `lib/capacitor.ts` behind the **same** React UI means the app doesn't
know which backend it's on. That seam is the whole port's leverage point.

## It's a subset — a mobile *player/viewer* tier, not the whole suite
| App | Mobile fit | Why |
|---|---|---|
| **ntune** | ✅ strong | radio/podcasts is the canonical on-the-go case |
| **nplay** | ✅ medium | owned music; local-file access differs on mobile |
| **nview** | ✅ shipped | already Capacitor (read + react) |
| **ndisc** | ❌ | disk-mutating publisher + large catalogue authoring |
| **ntree** | ❌ | filesystem FLAC scanner |
| **ncover** | ❌ hard no | GTK4 — not even desktop-portable, let alone mobile |
| **nsmpl** | ❌ | sample authoring + publish tooling |
| **nping** | ❌ | relay connectivity tool — pointless on a phone |

## ntune's gaps on mobile — honestly
- **Background audio + lock-screen controls — the make-or-break.** Desktop plays
  via webview `<audio>` + the U6 tray. On mobile that model dies: iOS suspends
  WKWebView audio when backgrounded; you need a native audio session
  (AVAudioSession *playback* + Now Playing / remote command centre) and Android
  **MediaSession + a foreground service**. This is *the* engineering risk and a
  Capacitor-plugin problem (community audio/media plugin vs a custom one).
- **ICY now-playing / the loopback proxy** → re-expressed in JS or a plugin; the
  desktop mixed-content workaround (`proxy.rs`) mostly evaporates on mobile.
- **Podcast RSS** → a JS parser instead of `feed-rs` (easy).
- **Signing** → already answered: **NIP-46 bunker, no keyring** (follow nview;
  matches SUITE.md's "no local keys on mobile").
- **Codecs, again** → mobile webview AAC+ decoding differs from Linux GStreamer;
  needs its own plays-on-my-platform check (the cross-session contract already
  treats codecs as the top risk — §6).

## A third, lightest tier worth remembering — PWA
nview already pulls `vite-plugin-pwa`, so an **installable PWA** is a near-free
read-only/lite surface (add-to-home-screen, offline shell). But background audio
on iOS PWAs is even more constrained than in a native shell, so a PWA is a
*viewer* answer, **not** a radio-player answer. Useful for a lite ntune "browse +
react" mode; not for the core listen-with-screen-off use.

## If it's ever picked up — the phased spike
Don't port an app; **spike the one thing that can kill it first.**
- **M0 — background-audio spike (decision gate).** Minimal ntune Capacitor shell;
  play a SomaFM stream with the **screen off** + working **lock-screen controls**,
  iOS *and* Android. Prove it or learn it's hard — cheaply, before committing.
- **M1 — the adapter.** `lib/capacitor.ts` implementing ntune's backend surface:
  local station store (Capacitor Preferences/Filesystem/SQLite), ICY now-playing,
  JS RSS, signing via NIP-46 bunker. Same React UI, swapped backend.
- **M2 — mobile UX pass.** Touch/density rework of the desktop-dense UI (header
  chips, hover-✕, collapse-flanks) → responsive mobile layout.
- **M3 — store distribution.** Apple Developer ($99/yr) + Play, following nview's
  pipeline (`@capacitor/assets`, `cap sync`, the signing/keystore setup).
- **Later — nplay mobile**, only once ntune proves the pattern.

## Open decisions (if resumed)
1. **Capacitor vs Tauri-mobile** — recommend Capacitor (suite coherence). Revisit
   only if the Rust core proves too costly to re-express in JS.
2. **Background-audio plugin** — adopt a community Capacitor audio/media plugin, or
   write a custom one for full Now-Playing/MediaSession control?
3. **Mobile state backend** — Capacitor Preferences vs Filesystem vs SQLite for the
   local station/podcast/favorites stores.
4. **Signing** — confirm bunker-only on mobile (no local nsec), as nview does.
5. **PWA tier** — is an installable PWA a good-enough "lite/browse" ntune, or
   native-shell only?
6. **Home** — this note graduates into `SUITE.md` (mobile is a suite-wide call) the
   moment it stops being a thought.
