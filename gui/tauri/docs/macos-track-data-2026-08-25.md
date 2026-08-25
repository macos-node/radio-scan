# macOS track-data measurements — the http/https split, and the two dead mounts

> **For the Windows (`xjmzx`) and Linux (`adjmx`) sessions.** Measurements taken on
> macOS 26.6.1 / WKWebView against `0.2.0-beta.2` installed from the release
> artifact. Feeds the parity ledger (`f025fea`) and answers the question Windows
> flagged as the crux. Contains one correction to my own earlier reading.

## 1. The crux question: where does https track text appear? — MEASURED

**Windows' model is right. ntune's player bar cannot show track text for an https
station.** Same box, same app, 40s per station, read from `nowplaying.json`:

```
21:42:57  https  playing=True   Lush              artist=None  track=None    ← 93s, nothing
21:44:30  http   playing=True   Acid Jazz         artist=None  track=None
21:44:37  http   playing=True   Acid Jazz         artist='Gota Yashiki'  track='Chase In The Urban Jungle'
21:45:18  http   playing=True   abstract hiphop   artist='Yunnan'        track='Feeltherain'
```

The http leg is the control that makes this a finding rather than an absence: the
feature demonstrably works on this box, so the https silence is the protocol.

By construction too: `setNowPlaying` has three call sites in `App.tsx`, two setting
`null`; the only one setting a value is the `onNowPlaying` subscription, emitted
from exactly one place (`proxy.rs`), which is in the path only for `http://`.
`station_icy` cannot fill the gap — it returns `icy-name`/`icy-genre`, not a track.

**Confound ruled out:** the https SomaFM seed *does* send `icy-metaint` (45000).
Plain `curl` gets `Empty reply from server` because SomaFM refuses on User-Agent;
with a normal UA the metadata is there. ntune simply never sees it.

## 2. Ledger refinement — macOS has NO https track data *today*

`f025fea` corrects the earlier claim by pointing at the logger, and is right about
the mechanism: `radioscan.py` reads ICY over http AND https, "for whichever stations
that box's config.json lists". On **this** Mac that list is one station, and it is
http:

    com.tigger.acidjazz → radioscan.py run --url http://79.111.14.76:8000/acidjazz
                                            --name acidjazz --data-dir ~/RadioTuner

No `config.json` exists here; the station is a single `--url` on the plist. So the
mac column should read **capable of https track data, currently covering none** —
the difference between "the source exists" and "the source covers that station".
The other two logged shows (On The Wire, A Duck in a Tree) are RSS parsers, not
stations, and never touch `radioscan.py`.

## 3. The two dead mounts — corroborating, with an independent number

`f025fea`'s diagnosis holds and I can add a second measurement by a different
method: frames parsed out of the stream pulled through **ntune's own proxy**
(port from `lsof` on the running app), so the whole app path is included.

| | |
|---|---|
| Wall time | 25 s |
| Audio delivered | **3.09 s** (133 ADTS frames @ 44100 Hz) |
| **Realtime factor** | **0.12x** |
| Proxy relay | continuous, no stall — 122,880 bytes, single connection |

Windows measured 0.07x; this is 0.12x. Same order, same conclusion, two methods.
**The proxy is innocent** — it relays steadily; the player starves because the
server delivers at a fraction of realtime. That is exactly the 7–9s
`playing=True → False` flap seen in `nowplaying.json`, with `artist`/`track`
*persisting* across it — proof the frontend's `stop()` never ran and the element
paused itself.

### Correction to my own earlier reading, because the trap is cheap to fall into

I first computed 188,416 bytes / 20 s = 74 kbps and reported that the server "lies
about bitrate" against its advertised `icy-br: 320`. **That was wrong.** 74 kbps was
the *delivery* rate, not the *encoded* rate. On an underdelivering stream those look
identical from bytes-per-second alone, and only a frame-level parse separates them —
the ADTS headers say AAC-LC 44100 Hz stereo, consistent with a genuine 320k mount.
`icy-br` is honest. Anyone measuring a suspect stream should count decoded frame
duration against wall time, not bytes against wall time.

## 4. `Needs-verify: macos` on `1249ed6` — a warning about the test itself

The remap is **a no-op on macOS by construction**, confirmed: `webview_content_type`
returns `ct` unchanged under `cfg!(target_os = "macos")`, and 48/48 Rust tests pass
here. Frontend 164/164, build clean.

**But the empirical half of that Needs-verify is a trap as written.** "Confirm an
`audio/aacp` station still plays" cannot be satisfied honestly on this box, because
**the only `audio/aacp` mounts available are the two underdelivering ones**. They do
not play on macOS — and they do not play for reasons that have nothing to do with
the MIME spelling. A session running that check naively would report a macOS
regression in `1249ed6` and be wrong.

What can be said: macOS behaviour is byte-for-byte unchanged, and the aacp mounts
fail here for the upstream reason measured above, corroborating rather than
contradicting Windows.

**A clean macOS aacp verification needs a healthy `audio/aacp` source**, which the
current seed list does not contain — SomaFM's AAC mount serves `audio/aac`, which
exercises the guard against rewriting backwards but not the legacy path. If Windows
or Linux knows a well-behaved aacp mount, that is the missing ingredient and the
check becomes a two-minute job on all three platforms.

---

## 5. Follow-up (2026-08-25, later): WKWebView plays BOTH spellings

`ae01069` withdrew the Needs-verify and supplied the missing ingredient —
`tests/aacp_healthy_server.py`, byte-identical audio with the MIME as the only
variable. Ran it on macOS. Both mounts added to ntune and tuned:

| mount | Content-Type | result |
|---|---|---|
| `127.0.0.1:8801` | `audio/aacp` | **plays** (operator confirmed audibly) |
| `127.0.0.1:8802` | `audio/aac`  | **plays** — operator confirmed, and `nowplaying.json` held `playing=true` continuously across a 26s sample |

**This refutes the last standing premise in `webview_content_type`.** Its doc
comment said *"WKWebView (macOS) is the sole webview that wants the legacy
spelling — it fails on `audio/aac`"*, tracing back to a 2026-08-04 note. macOS does
not fail on `audio/aac`. Like WebView2, the media pipeline sniffs the content and
ignores the label.

So **all three webviews play both spellings**, and the `macos` arm of that `cfg` is
a no-op preserved by caution, not a capability requirement. That is the same shape
of error `ae01069` corrected for WebView2 — capability inferred rather than A/B'd —
and it survived one round longer because macOS was the platform nobody re-tested.

**Changed here:** the doc comment and the test's assertion message, so neither
asserts a false capability. **Not changed:** behaviour. The function could collapse
to an unconditional remap —

```rust
if ct.eq_ignore_ascii_case("audio/aacp") { "audio/aac".into() } else { ct.into() }
```

— removing the last platform special-case in the proxy's MIME handling. That is a
runtime change to shared code that currently works on all three platforms, so it is
**proposed, not taken**: Windows owns the recent work there and Linux has not
re-tested either spelling. If both agree, macOS will land it with the A/B repeated
after the change.

*Method note, since it is the reusable part:* the operator hears the audio, the
`nowplaying.json` `playing` flag shows the element is not paused. Neither alone is
enough — a stalled element can look paused-but-fine, and a flag can hold true over
silence — so both legs were taken for the decisive `audio/aac` case.
