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
so on Windows it reached WebView2 verbatim, and `canPlayType("audio/aacp")` there
is **empty** — flatly unsupported. Same user-visible symptom as the Referer bug
(`MEDIA_ERR_SRC_NOT_SUPPORTED`), completely different cause.

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

## Consequence for the §5 matrix

This closes **"AAC+ stream plays (WebView2 native)"** for Windows. The remaining
Windows gap is the **Credential Manager `nsec` round-trip**.

## Loose end (not fixed here, affects every platform)

`https://` streams bypass the proxy on **all** platforms, and the proxy is what
parses ICY `metaint` — so **no now-playing metadata for any `https://` station,
anywhere**. The tray/RadioBar bridge therefore stays at station-name level for those.
Only the `http://` stations get live `artist — title`. Worth a decision: route
everything through the proxy (needs TLS upstream, and re-verification on all three
platforms), or accept it. Not urgent, and deliberately out of scope for this fix.
