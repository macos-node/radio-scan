# ntune — cross-session change contract v1.0

> Status: ACCEPTED v1.0 2026-08-04 (macOS + Linux sessions). Adapted from
> `xjmzx/pong` CONTRIBUTING-cross-session v1.0. Amend in place; major changes get
> a new version header.

Two Claude sessions ship `gui/tauri` (ntune) in lockstep off one branch
(`l4-ui-u0` → `main`): **Linux** (`adjmx`) and **macOS** (`macos-node`). This is
a light contract, not process for its own sake — it exists to stop one session
shipping a change through a platform path it can't run. ntune is the first thing
in this repo that actually **plays audio**, and the webview differs per OS, so
"it works here" is not "it works there."

## 1. The one rule that matters: `Needs-verify`
Every shared change names the platform(s) it was **not** run on, with the
specific path. Make it grep-able:

```
Needs-verify: linux   (AAC+ playback in webkit2gtk / gst codecs)
Needs-verify: macos   (Keychain nsec read on first sign)
```

`git log --grep "Needs-verify"` is then the open-verification queue. A change
with **no** Needs-verify line asserts the author ran every path it touches.

## 2. Commit-message header
For any change beyond a localized same-platform fix, put in the commit body:

- **What** — one sentence
- **Surface** — stations / player / themes / signing / all
- **Platforms affected** — all (shared TS/React) / rust-only (`src-tauri`) /
  os-specific (keyring, ICY proxy)
- **Tested** — OS(es) actually run
- **Needs-verify** — see §1 (omit only if truly none)

Net-new features wanting design review *first* → a `docs/` note (cf.
`docs/radio-scan-ui-2026-08-04.md`). For everything else the commit body is
enough — no PR overhead between trusted sessions.

## 3. Release gate (protects users)
Push to the branch freely; smoke-test on your platform first. **But do not cut
an `ntune-v*` tag while a change with an open `Needs-verify` sits on a
release-critical path**, until the named session confirms. Release-critical
paths = **audio playback**, **keyring `nsec` signing**, and (from U3) the **ICY
now-playing proxy**. Cosmetic or self-contained changes don't gate.

Verification reply = a follow-up commit `verified: <os> — <path>` (or a fix
commit if broken).

## 4. CI builds both platforms — but it can't hear
`.github/workflows/ntune-release.yml` builds mac `.dmg` + Linux
`.deb`/`.AppImage` from one `ntune-v*` tag, so neither session hand-builds the
other's installer. **But CI has no audio device and installs no GStreamer codec
plugins** — it proves the app *compiles and bundles*, never that a stream
*plays*. Every release still needs a human "it plays on my platform" check per
the matrix below. That check is the real gate, not the green build.

## 5. Build / verification matrix (who validates what)

| Platform | Bundle | Webview | Verify on real hardware |
|---|---|---|---|
| macOS arm64 | `.dmg` → `/Applications` | WKWebView | AAC+ stream actually plays; Keychain `nsec`; `~/Library/Application Support/uk.fizx.ntune` paths |
| Linux x86_64 | `.deb` / `.AppImage` → `~/Applications` | webkit2gtk 4.1 | AAC+ stream plays **with `gstreamer1.0-plugins-bad` + `-libav` installed**; libsecret `nsec`; XDG paths |

Local install for either side: `scripts/build-install.sh` (native bundle for the
OS you run it on). Dev loop: `scripts/dev.sh`.

## 6. Cross-cutting risks (smoke-test on the platform that exercises the path)
- **Audio codecs (the big one).** webkit2gtk plays the `<audio>` element via
  GStreamer; AAC/AAC+ decoding needs `gstreamer1.0-plugins-bad` +
  `gstreamer1.0-libav` on the **user's** machine. A stream that plays on macOS's
  WKWebView can be **silent on Linux**. The `.deb` should declare these as
  Depends; the `.AppImage` can't bundle them reliably, so document them. Canary:
  the player shows "playing" but there's no sound.
- **Keyring `nsec` (U2+).** macOS Keychain vs Linux libsecret / Secret Service;
  a headless Linux box may have no keyring daemon running at all.
- **ICY now-playing proxy (U3+).** The Rust port of `radioscan.py` — localhost
  loopback port + any firewall between the webview and the proxy.
- **State paths.** Use Tauri's app-data / app-config dirs — never hardcode
  `~/.config` or `~/Library`.

## Acceptance log
- **v1.0** (macOS `macos-node`, 2026-08-04) — initial proposal, adapted from
  `xjmzx/pong` CONTRIBUTING-cross-session v1.0. Pending Linux (`adjmx`)
  acceptance.
- **v1.0 accepted** (Linux `adjmx`, 2026-08-04) — adopted as of ntune U2; the U2
  commit follows §2 (header) and §1 (`Needs-verify: linux/macos` on the keyring
  path). Both sessions now bound to v1.0.
