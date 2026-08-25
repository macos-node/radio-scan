# ntune — why no https:// station played on Windows (the Referer 403)

> **Status: FIXED 2026-08-25 (Windows `macos-node`), one line in `index.html`.**
> A §2 change note under [`../CONTRIBUTING-cross-session.md`](../CONTRIBUTING-cross-session.md).
> **No action needed on macOS/Linux** — the fix is inert there (see "Why only
> Windows"), but it is a shared file, so: **Needs-verify: macos, linux** (a station
> still plays; nothing else regressed).

## Symptom

On Windows, a SomaFM **AAC** station wouldn't play. It looked like the standing
"AAC+ in WebView2" question from the §5 matrix — the one Windows gap nobody had
ever run. It was not that.

## What it actually was

Measured over the WebView2 debugger, the failure is **not** codec-specific and
**not** AAC-specific — it split by **URL scheme**:

| Station | Route | Result |
|---|---|---|
| AAC `https://` | direct | ❌ `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) |
| MP3 `https://` | direct | ❌ `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) |
| MP3 `http://` | via our proxy | ✅ plays |
| AAC `http://` | via our proxy | ✅ plays |

AAC played *fine* through the proxy, and `canPlayType('audio/aac')` returns
`"probably"` — **WebView2 decodes HE-AAC without complaint**. Only the direct
`https://` path failed, for MP3 and AAC alike.

The network capture gave the answer. The direct request carried:

```
Referer: http://tauri.localhost/
```

and SomaFM answered **403 Forbidden** (`Content-Length: 0`) — it refuses hotlinked
requests. The media element reports that 403 as `SRC_NOT_SUPPORTED`, which is why
this masqueraded as a codec problem. Confirmed independently with curl against the
same URL: identical request **with** a `Referer` → 403, **without** one → 200.
User-Agent, `Origin`, and `Range` are all irrelevant — only `Referer` flips it.

`App.tsx` routes **only `http://`** through the Rust proxy (the proxy exists for
mixed-content, and `https://` needs no such help). The proxy makes its own upstream
request and sends no `Referer`, which is exactly why the proxied stations played —
the working path was masking the broken one.

## Why only Windows

The page origin differs per platform:

- **macOS / Linux** — `tauri://localhost`, an opaque custom scheme. No `Referer` is
  ever attached, so SomaFM sees a clean request and returns 200.
- **Windows** — `http://tauri.localhost`, a **real HTTP origin** (visible in
  `document.location`, and in the localStorage origin the durability work turned up).
  Chromium therefore attaches a normal `Referer` to subresource requests — including
  media.

So every `https://` station was broken on Windows from the first build, and could
not reproduce on either other platform.

## The fix — a document-level referrer policy

```html
<meta name="referrer" content="no-referrer" />
```

in `index.html`. Measured: `Referer` empty → **200** → stream plays.

**The per-element attribute does not work.** `audio.referrerPolicy='no-referrer'`
(and the matching content attribute) reflects correctly and is still **ignored** for
the media load — the `Referer` goes out anyway and the 403 stands. Chromium honours
`referrerpolicy` on `<img>`/`<script>`, but media requests take the **document**
policy. Both were measured on WebView2 151; only the document policy works.

Rejected alternative: teaching the proxy TLS so `https://` could be routed through
it too. That is a much larger change (the proxy is raw `TcpStream` + hand-parsed
HTTP for the ICY `metaint` path), and it would change the working path on macOS and
Linux for a problem neither has.

The policy is also simply correct: a desktop app has no business leaking its internal
origin to third-party stream hosts. It is inert on macOS/Linux, which already sent
no `Referer`.

## Verified (Windows, `macos-node`, 2026-08-25, v0.2.0-beta.2)

Rebuilt and re-measured in the shipped build — `meta[name=referrer]` = `no-referrer`:

| Station | Route | Referer | Status | Result |
|---|---|---|---|---|
| Groove Salad **AAC** | https direct | (empty) | 200 | ✅ PLAYING |
| Groove Salad MP3 | https direct | (empty) | 200 | ✅ PLAYING |
| Indie Pop Rocks | https direct | (empty) | 200 | ✅ PLAYING |
| Drone Zone | http via proxy | (empty) | 200 | ✅ PLAYING |

4/4, where 3/4 failed before. `PLAYING` here is the media element's own event with
`readyState=4` — the decoder is producing frames, i.e. HE-AAC decodes natively in
WebView2 with no GStreamer-style codec install.

## Second defect, found by the same session's playback pass: legacy `audio/aacp`

With the Referer fixed, every SomaFM station and every podcast played — but two
stations still would not: **Acid Jazz** and **abstract hiphop**, both 320k HE-AAC
mounts on one Icecast 2.4.0-kh4 server, both `http://` (so both *proxied*, a
different path from the https ones above). They show as "0k" in the UI only because
they were never ICY-probed; the bitrate is not the problem.

Their `Content-Type` is the **legacy `audio/aacp`** — the Shoutcast-era spelling.
`proxy.rs` remapped that to `audio/aac` **only under `cfg!(target_os = "linux")`**,
so on Windows it reached WebView2 verbatim, where `canPlayType("audio/aacp")` is
**empty**. I read that as "flatly unsupported". **That inference was wrong — see the
correction below.**

The rule the old code encoded was backwards-scoped. **WKWebView (macOS) is the only
webview that wants the legacy spelling**; webkit2gtk and WebView2 both want
`audio/aac`. So the condition is now inverted — macOS keeps `audio/aacp`, everyone
else gets `audio/aac` — which leaves macOS and Linux behaviour exactly as it was and
fixes Windows. Extracted as `webview_content_type()` with three unit tests (the
remap, its case-insensitivity, and that **`audio/aac` is never rewritten backwards**),
proxy.rs's first tests.

Measured after the fix, in the release build:

| Station | MIME | Route | Before | After |
|---|---|---|---|---|
| Acid Jazz | `audio/aacp` | http, proxied | ❌ | ✅ PLAYING |
| abstract hiphop | `audio/aacp` | http, proxied | ❌ | ✅ PLAYING |
| Drone Zone | `audio/mpeg` | http, proxied | ✅ | ✅ (no regression) |
| Groove Salad AAC | `audio/aac` | https, direct | ✅ | ✅ (no regression) |

**User-confirmed audible 2026-08-25**: AAC and all 128k streams play, podcasts play.

### ⚠️ CORRECTION 2026-08-25 — `1249ed6`'s causal claim does not hold

Prompted by macOS refusing to rubber-stamp that commit's `Needs-verify`
([`macos-track-data-2026-08-25.md`](macos-track-data-2026-08-25.md) §4): the only
`audio/aacp` mounts anyone had were the two that underdeliver, so "confirm an aacp
station still plays" could not be answered honestly. To remove the confound I built a
**healthy local aacp source** ([`../../tests/aacp_healthy_server.py`](../../tests/aacp_healthy_server.py)) —
real ADTS captured at runtime, looped from localhost, `Content-Type` as the only
variable, with a `--kbps` throttle to reproduce starvation on demand.

What it measured on WebView2 151, byte-identical audio in every row:

| Delivery | MIME | Direct to element | Through the proxy |
|---|---|---|---|
| healthy (1.31× realtime) | `audio/aacp` | ✅ plays (3/3) | ✅ plays |
| healthy | `audio/aac` | ✅ plays | ✅ plays |
| **starved (13 kbps, ~0.1×)** | `audio/aacp` | ✅ **plays** | ✅ plays |
| **starved** | `audio/aac` | ✅ plays | ✅ plays |

**WebView2 plays `audio/aacp` fine — healthy or starved, proxied or not.**
`canPlayType` returning `""` is a *conservative advisory*, not a gate: the media
pipeline sniffs the content and ignores the unrecognised label. I inferred a hard
capability from an advisory string, which was the error.

So the honest position on those two mounts: **the MIME spelling was almost certainly
never why they failed.** The before/after I recorded above is confounded — those mounts
were independently measured swinging between **19 and 325 kbps**, so a failing "before"
and a passing "after" is exactly what that variance produces on its own. I do not have a
controlled reproduction of an aacp-caused failure, and two attempts to build one both
came back negative.

**The change itself stands, on different grounds.** `audio/aac` is the correct modern
spelling, WKWebView is genuinely the only webview wanting the legacy one, and Windows
now matches Linux instead of diverging from it by accident of a `cfg`. It is a
consistency fix with 48/48 tests behind it — it is simply **not** the thing that made
those two stations play.

**The `Needs-verify: macos, linux` on `1249ed6` is withdrawn.** macOS was right that it
could not be answered, and the premise it rested on turns out to be unsupported. What
remains is an ordinary no-regression check, and the test server above makes it a
two-minute job on any platform:

```
python3 tests/aacp_healthy_server.py                            # aacp on :8801
python3 tests/aacp_healthy_server.py --content-type audio/aac --port 8802   # control
```

Both should play everywhere. On macOS both should play with the remap being a literal
no-op; if `audio/aacp` ever *fails* somewhere, that is the finding worth reporting.

## Consequence for the §5 matrix

This closes **"AAC+ stream plays (WebView2 native)"** for Windows. The remaining
Windows gap is the **Credential Manager `nsec` round-trip**.

## Loose end (not fixed here): ntune's IN-APP now-playing is `http://`-only

`https://` streams bypass the proxy on **all** platforms, and the proxy is the only
thing that parses ICY `metaint` — so ntune's **own** now-playing readout (the player
bar, and what it writes to the bridge file) is blank for `https://` stations on every
platform. Only `http://` stations get live `artist — title` from ntune itself.

> **Correction — an earlier draft of this section said "no now-playing metadata for
> any `https://` station, anywhere". That was wrong**, and the mistake is worth
> recording: it reasoned only about ntune's in-app path and missed the **`radioscan.py`
> logger** entirely. The logger is a separate 24/7 service (launchd on macOS, systemd
> on Linux) that opens streams itself with `urllib` + raw sockets, so it reads ICY over
> **http and https alike**, for whichever stations that machine's `config.json` lists.
> macOS and Linux therefore *do* have https track data — from the logger, not from
> ntune's proxy. **Windows runs no logger at all** (`lib.rs` says so), which is why the
> gap is visible there and nowhere else.

Whether to close it in-app — give the proxy TLS and route `https://` through it too —
is a live decision, not a settled one. See
[`../../docs/platform-parity-2026-08-25.md`](../../docs/platform-parity-2026-08-25.md)
for the three-platform picture and the options.
