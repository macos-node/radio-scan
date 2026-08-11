# ntune — cross-session change contract v1.1

> Status: **v1.1 ACCEPTED 2026-08-05 (macOS + Linux)** — adds §7 (CI hygiene) + §8
> (release cadence) on top of v1.0 (accepted 2026-08-04). Adapted from
> `xjmzx/pong`. Amend in place; major changes get a new version header.
>
> **Note 2026-08-11 (macOS `macos-node`).** (1) A **Windows** build is prototyping —
> §5 matrix Windows row added. (2) The **now-playing bridge** is a §2
> design-review-first item:
> [`docs/nowplaying-bridge-2026-08-11.md`](docs/nowplaying-bridge-2026-08-11.md) is
> authoritative; its shared-state path + payload must be agreed across all three
> sessions BEFORE any tray build. **Status: Windows + macOS + Linux all acked
> 2026-08-11 — `write_nowplaying` UNBLOCKED.** Path constant
> `radio-scan/nowplaying.json` off each OS's `local_data_dir()` base; the contract
> is now frozen additive-only.

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
`.github/workflows/ntune-release.yml` builds mac `.dmg` + Linux `.deb` from one
`ntune-v*` tag, so neither session hand-builds the other's installer. (The
`.AppImage` is deferred — it freezes on playback; see
`docs/appimage-gstreamer-2026-08-04.md`.) **But CI has no audio device and installs no GStreamer codec
plugins** — it proves the app *compiles and bundles*, never that a stream
*plays*. Every release still needs a human "it plays on my platform" check per
the matrix below. That check is the real gate, not the green build.

## 5. Build / verification matrix (who validates what)

| Platform | Bundle | Webview | Verify on real hardware |
|---|---|---|---|
| macOS arm64 | `.dmg` → `/Applications` | WKWebView | AAC+ stream actually plays; Keychain `nsec`; `~/Library/Application Support/uk.fizx.ntune` paths |
| Linux x86_64 | `.deb` (system install; AppImage deferred) | webkit2gtk 4.1 | AAC+ stream plays **with `gstreamer1.0-plugins-bad` + `-libav` installed**; libsecret `nsec`; XDG paths |
| Windows x86_64 (`macos-node`, prototyping) | `.exe` (NSIS-only) | WebView2 (Edge Chromium) | AAC+ stream plays (WebView2 native); Credential Manager `nsec` (`windows-native` keyring); `%LOCALAPPDATA%` paths; tray companion on by default (`--no-tray` opts out) |

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

## 7. CI hygiene — `main` stays green
`.github/workflows/ci.yml` runs three jobs on every push: **Python core**,
**ntune** (Linux `tsc` + `cargo check`), **RadioBar** (macOS `swift build`). A
green `main` is an **invariant**, not a nicety — a red baseline hides the *next*
real break, which is exactly how the RadioBar Swift-6 / macos-14 failure sat
unnoticed for days while ntune had no CI at all.
- **You red it, you fix it.** A push that turns CI red is the top priority for the
  session that pushed — fix forward or revert before more feature work or handoff.
- **No `ntune-v*` tag on a red `main`** (extends §3, alongside the open-`Needs-verify`
  gate). CI proves *compile + bundle*; it still can't hear (§4), so it gates the
  tag, it doesn't replace the human plays-on-my-platform check.
- **Never normalize red.** If a job is genuinely not our concern, fix or remove it —
  don't leave it failing as "known noise."

## 8. Release cadence — a beta per phase
Walk the release path often so it can't quietly rot (packaging drift — the AppImage
GStreamer gap, the `.deb` codec Depends — should surface per phase, not at a big
release).
- **Cut a `-beta.N` pre-release at the end of each phase/feature** (U4b, U5, …). The
  `-beta` hyphen auto-marks it a GitHub pre-release; `ntune-release.yml` builds both
  `.deb` + `.dmg` each time, so each session gets an installable artifact to smoke-test.
- **Promote to a stable `0.x.0`** once a batch of betas is validated on both platforms
  (features → `-beta.N` → stable minor).
- **Pre-tag checklist:** CI green (§7) · no open release-critical `Needs-verify` (§3) ·
  version bumped across the manifests + a `CHANGELOG.md` entry · each platform has run
  the plays-on-my-platform check (§4 / §5).

## Acceptance log
- **v1.0** (macOS `macos-node`, 2026-08-04) — initial proposal, adapted from
  `xjmzx/pong` CONTRIBUTING-cross-session v1.0. Pending Linux (`adjmx`)
  acceptance.
- **v1.0 accepted** (Linux `adjmx`, 2026-08-04) — adopted as of ntune U2; the U2
  commit follows §2 (header) and §1 (`Needs-verify: linux/macos` on the keyring
  path). Both sessions now bound to v1.0.
- **v1.1 proposed** (Linux `adjmx`, 2026-08-05) — adds §7 (CI hygiene: green
  `main` invariant, no tag on red) and §8 (release cadence: `-beta.N` per phase),
  after the 0.1.1-beta.1 convergence exposed a long-red CI (RadioBar Swift-6 vs
  macos-14; ntune had no CI). Pending macOS acceptance.
- **v1.1 accepted** (macOS `macos-node`, 2026-08-05) — reviewed §7 (green-`main`
  invariant; you-red-it-you-fix-it; no `ntune-v*` tag on red) and §8 (a `-beta.N`
  per phase + the pre-tag checklist). Both directly address failures we hit this
  session — the long-red CI and packaging drift (AppImage/codec). Adopted as-is;
  both sessions now bound to v1.1.
