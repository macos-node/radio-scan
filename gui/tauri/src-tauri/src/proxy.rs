// Loopback stream proxy — the fix for radio playback in packaged builds, and the
// U3 foundation.
//
// A packaged app loads its UI from a *secure* origin (`tauri://localhost` on
// macOS). WebKit blocks a plain `http://` media subresource loaded from a secure
// origin as MIXED CONTENT — a separate policy from App Transport Security, so it
// can't be turned off with an Info.plist key. Most internet radio is plain
// http://, so the webview can't play it directly.
//
// `http://127.0.0.1` is a "potentially trustworthy" origin, so playing through
// this loopback proxy is NOT mixed content on any platform. The webview plays
// `http://127.0.0.1:<port>/?url=<upstream>`.
//
// It's a raw TCP relay, not an HTTP client: we read the webview's request line,
// open the upstream, and copy its bytes — HTTP response and all — straight back.
// The upstream's own headers (incl. Content-Type) reach the webview verbatim, and
// an endless Icecast stream just keeps copying until the webview disconnects.
// Only http:// is proxied (that's the mixed-content case); https:// plays
// directly from the renderer, so no TLS client is needed here.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A now-playing update parsed from the ICY metadata stream (U3), emitted to the
/// frontend as a `now-playing` event. `url` identifies the upstream so the UI can
/// ignore events for a station it's no longer tuned to.
#[derive(Serialize, Clone)]
struct NowPlaying {
    url: String,
    title: String,
    artist: String,
}

/// Start the loopback proxy on its OWN thread + tokio runtime and return the
/// bound port. Self-contained so it never depends on Tauri's async runtime
/// (nested spawns on which were leaving connections unhandled). `app` is used to
/// emit now-playing events parsed from the ICY metadata stream.
pub fn start(app: AppHandle) -> std::io::Result<u16> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("ntune-proxy".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = tx.send(Err(e));
                    return;
                }
            };
            rt.block_on(async move {
                let listener = match TcpListener::bind(("127.0.0.1", 0)).await {
                    Ok(l) => l,
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        return;
                    }
                };
                let _ = tx.send(listener.local_addr().map(|a| a.port()));
                loop {
                    match listener.accept().await {
                        Ok((sock, _)) => {
                            tokio::spawn(handle(sock, app.clone()));
                        }
                        Err(_) => break,
                    }
                }
            });
        })?;
    rx.recv()
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "proxy thread exited"))?
}

const MAX_REDIRECTS: u8 = 6;

async fn handle(mut client: TcpStream, app: AppHandle) {
    let Some(orig_url) = read_target(&mut client).await else {
        let _ = client
            .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            .await;
        return;
    };
    // Follow redirects ourselves — podcast enclosures almost always go through a
    // tracking/CDN 30x, and radio mounts sometimes do too. `orig_url` stays fixed
    // for the now-playing event so the UI still matches the station it tuned.
    let mut url = orig_url.clone();

    for _ in 0..=MAX_REDIRECTS {
        let Some((authority, path)) = split_http_url(&url) else {
            let _ = client
                .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
                .await;
            return;
        };

        let mut upstream = match TcpStream::connect(authority.as_str()).await {
            Ok(s) => s,
            Err(_) => {
                let _ = client
                    .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                    .await;
                return;
            }
        };

        // Ask for inline ICY metadata (Icy-MetaData: 1) so we can surface
        // now-playing (U3). HTTP/1.0 + Connection: close = stream the body until
        // the connection drops, exactly how Icecast serves an endless stream.
        let host = authority.split(':').next().unwrap_or(&authority);
        let req = format!(
            "GET {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: ntune (radio-scan)\r\nIcy-MetaData: 1\r\nConnection: close\r\n\r\n"
        );
        if upstream.write_all(req.as_bytes()).await.is_err() {
            return;
        }

        let Some(head) = read_upstream_head(&mut upstream).await else {
            let _ = client
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                .await;
            return;
        };

        // Redirect handling: http -> http we follow ourselves; http -> https we
        // hand off to the webview (https from its secure origin is fine — unlike
        // the plain http this proxy exists to work around — and needs no TLS here).
        if matches!(head.status, 301 | 302 | 303 | 307 | 308) {
            let Some(loc) = head.location.as_deref().map(|l| resolve_location(l, &url)) else {
                let _ = client
                    .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                    .await;
                return;
            };
            if loc.starts_with("https://") {
                let resp =
                    format!("HTTP/1.1 302 Found\r\nLocation: {loc}\r\nConnection: close\r\n\r\n");
                let _ = client.write_all(resp.as_bytes()).await;
                return;
            }
            url = loc;
            continue;
        }

        // Non-redirect (2xx): relay to the webview with our OWN clean HTTP/1.1
        // head (its media loader is fussier than curl about HTTP/1.0 + close).
        let content_type = webview_content_type(&head.content_type);
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        );
        if client.write_all(resp.as_bytes()).await.is_err() {
            return;
        }

        match head.metaint {
            // Inline metadata: strip it, relay clean audio, emit now-playing.
            Some(n) if n > 0 => {
                relay_icy(&mut upstream, &mut client, n, head.body_head, &app, &orig_url).await;
            }
            // No inline metadata: straight passthrough (podcast files, or servers
            // that ignored Icy-MetaData). Audio still plays; no now-playing.
            _ => {
                if !head.body_head.is_empty()
                    && client.write_all(&head.body_head).await.is_err()
                {
                    return;
                }
                let _ = tokio::io::copy(&mut upstream, &mut client).await;
            }
        }
        return;
    }

    let _ = client
        .write_all(b"HTTP/1.1 508 Loop Detected\r\nConnection: close\r\n\r\n")
        .await;
}

/// Resolve a redirect `Location` against the current URL: absolute as-is,
/// root-relative against the host, otherwise joined to the base's directory.
fn resolve_location(loc: &str, base: &str) -> String {
    if loc.starts_with("http://") || loc.starts_with("https://") {
        loc.to_string()
    } else if let Some(rest) = loc.strip_prefix('/') {
        match split_http_url(base) {
            Some((authority, _)) => format!("http://{authority}/{rest}"),
            None => loc.to_string(),
        }
    } else {
        match base.rsplit_once('/') {
            Some((dir, _)) => format!("{dir}/{loc}"),
            None => loc.to_string(),
        }
    }
}

/// Relay an ICY (Icecast/SHOUTcast) stream: every `metaint` audio bytes the
/// server injects a metadata block (1 length byte × 16, then that many bytes of
/// `StreamTitle='…';`). Forward only the audio to the webview; parse each title
/// and emit it as a `now-playing` event. Ends when either side closes. Ported
/// from radioscan.py's `icy_meta_generator` (same read/decode logic).
async fn relay_icy(
    upstream: &mut TcpStream,
    client: &mut TcpStream,
    metaint: usize,
    initial: Vec<u8>,
    app: &AppHandle,
    url: &str,
) {
    let mut src = IcySource { up: upstream, buf: initial, pos: 0 };
    let mut last = String::new();
    loop {
        // `metaint` bytes of pure audio → straight to the webview.
        let Some(audio) = src.read_exact(metaint).await else { break };
        if client.write_all(&audio).await.is_err() {
            break;
        }
        // One length byte (×16) gives the metadata block size.
        let Some(lenb) = src.read_exact(1).await else { break };
        let meta_len = lenb[0] as usize * 16;
        if meta_len == 0 {
            continue; // no change this interval
        }
        let Some(meta) = src.read_exact(meta_len).await else { break };
        let trimmed = strip_trailing_nuls(&meta);
        if trimmed.is_empty() {
            continue;
        }
        let text = decode_icy(trimmed);
        let Some(raw) = extract_stream_title(&text) else { continue };
        let raw = raw.trim();
        if raw.is_empty() || raw == last {
            continue;
        }
        last = raw.to_string();
        let (artist, title) = split_artist_title(raw);
        let _ = app.emit(
            "now-playing",
            NowPlaying { url: url.to_string(), title, artist },
        );
    }
}

/// A pull reader over the upstream socket with a leftover buffer, so we can read
/// exact byte counts across arbitrary chunk boundaries (like Python read_exactly).
struct IcySource<'a> {
    up: &'a mut TcpStream,
    buf: Vec<u8>,
    pos: usize,
}

impl IcySource<'_> {
    async fn read_exact(&mut self, n: usize) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(n);
        while out.len() < n {
            if self.pos >= self.buf.len() {
                self.buf.clear();
                self.pos = 0;
                let mut tmp = [0u8; 8192];
                let read = self.up.read(&mut tmp).await.ok()?;
                if read == 0 {
                    return None; // upstream closed
                }
                self.buf.extend_from_slice(&tmp[..read]);
            }
            let take = std::cmp::min(n - out.len(), self.buf.len() - self.pos);
            out.extend_from_slice(&self.buf[self.pos..self.pos + take]);
            self.pos += take;
        }
        Some(out)
    }
}

fn strip_trailing_nuls(b: &[u8]) -> &[u8] {
    let end = b.iter().rposition(|&c| c != 0).map_or(0, |i| i + 1);
    &b[..end]
}

/// ICY metadata is UTF-8, else Windows-1251 (common on RU servers), else Latin-1.
/// Mirrors radioscan.py's `decode_bytes` ladder.
fn decode_icy(b: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(b) {
        return s.to_string();
    }
    let (s, _, had_errors) = encoding_rs::WINDOWS_1251.decode(b);
    if !had_errors {
        return s.into_owned();
    }
    b.iter().map(|&c| c as char).collect() // Latin-1: infallible, byte == code point
}

/// Pull the value out of `StreamTitle='…';` (first match, non-greedy up to `';`).
fn extract_stream_title(text: &str) -> Option<String> {
    const KEY: &str = "StreamTitle='";
    let start = text.find(KEY)? + KEY.len();
    let rest = &text[start..];
    let end = rest.find("';")?;
    Some(rest[..end].to_string())
}

/// "Artist - Title" -> (artist, title); no separator -> ("", whole string).
fn split_artist_title(raw: &str) -> (String, String) {
    match raw.split_once(" - ") {
        Some((a, t)) => (a.trim().to_string(), t.trim().to_string()),
        None => (String::new(), raw.trim().to_string()),
    }
}

/// The parsed upstream response head.
struct Head {
    status: u16,
    content_type: String,
    /// icy-metaint, when the stream carries inline metadata.
    metaint: Option<usize>,
    /// Location, on a redirect.
    location: Option<String>,
    /// Body bytes already read past the `\r\n\r\n` terminator.
    body_head: Vec<u8>,
}

/// Read + parse the upstream HTTP (or ICY) response head.
async fn read_upstream_head(up: &mut TcpStream) -> Option<Head> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 2048];
    loop {
        let n = up.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..pos]);
            // Status line: "HTTP/1.x CODE …" or SHOUTcast "ICY CODE …".
            let status = head
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|c| c.parse::<u16>().ok())
                .unwrap_or(200);
            let header = |name: &str| {
                head.lines()
                    .filter_map(|l| l.split_once(':'))
                    .find(|(k, _)| k.trim().eq_ignore_ascii_case(name))
                    .map(|(_, v)| v.trim().to_string())
            };
            let content_type =
                header("content-type").unwrap_or_else(|| "application/octet-stream".to_string());
            let metaint = header("icy-metaint").and_then(|v| v.parse::<usize>().ok());
            let location = header("location");
            return Some(Head {
                status,
                content_type,
                metaint,
                location,
                body_head: buf[pos + 4..].to_vec(),
            });
        }
        if buf.len() > 16384 {
            return None;
        }
    }
}

/// "http://host[:port]/path" -> ("host:port", "/path"), defaulting port 80.
/// Returns None for anything that isn't a plain http:// URL.
/// The Content-Type to hand the webview for an upstream that advertises `ct`.
///
/// Only ONE stream MIME needs touching: the legacy `audio/aacp` that Shoutcast-era
/// servers still send for HE-AAC (SomaFM's AAC mount says `audio/aac` and passes
/// straight through). macOS keeps the legacy spelling here — but NOT because it
/// needs it. **Measured on WKWebView 2026-08-25 with `tests/aacp_healthy_server.py`,
/// byte-identical audio and the MIME as the only variable: `audio/aacp` AND
/// `audio/aac` both play.** The earlier "it fails on `audio/aac`" was never A/B'd
/// and is false, so the `macos` arm below is currently a no-op preserved for
/// caution rather than a capability requirement — see the note in
/// docs/macos-track-data-2026-08-25.md before relying on it. Everyone else wants
/// the modern one:
/// webkit2gtk needs it, and so does **WebView2**, whose
/// `canPlayType("audio/aacp")` is empty, i.e. flatly unsupported — measured on
/// WebView2 151.
///
/// This was written as "remap only on Linux", which left Windows passing
/// `audio/aacp` through to a webview that cannot play it: every `audio/aacp`
/// station failed there with MEDIA_ERR_SRC_NOT_SUPPORTED while `audio/mpeg` and
/// `audio/aac` ones played. Inverting it to "macOS keeps the legacy MIME, everyone
/// else gets `audio/aac`" states the actual rule and leaves mac + Linux unchanged.
/// See docs/windows-playback-2026-08-25.md.
fn webview_content_type(ct: &str) -> String {
    if !cfg!(target_os = "macos") && ct.eq_ignore_ascii_case("audio/aacp") {
        "audio/aac".to_string()
    } else {
        ct.to_string()
    }
}

fn split_http_url(target: &str) -> Option<(String, String)> {
    let rest = target.strip_prefix("http://")?;
    let (authority, path) = match rest.split_once('/') {
        Some((a, p)) => (a, format!("/{p}")),
        None => (rest, "/".to_string()),
    };
    if authority.is_empty() {
        return None;
    }
    let authority = if authority.contains(':') {
        authority.to_string()
    } else {
        format!("{authority}:80")
    };
    Some((authority, path))
}

/// Read only the HTTP request line and pull the percent-encoded `url` param.
async fn read_target(sock: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 1024];
    loop {
        let n = sock.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(2).position(|w| w == b"\r\n") {
            let line = std::str::from_utf8(&buf[..pos]).ok()?;
            return target_from_request_line(line);
        }
        if buf.len() > 8192 {
            return None;
        }
    }
}

/// "GET /?url=<percent-encoded> HTTP/1.1" -> the decoded upstream URL.
fn target_from_request_line(line: &str) -> Option<String> {
    let path = line.split(' ').nth(1)?;
    let query = path.split_once('?')?.1;
    let enc = query.split('&').find_map(|kv| kv.strip_prefix("url="))?;
    let decoded = percent_encoding::percent_decode_str(enc)
        .decode_utf8()
        .ok()?
        .into_owned();
    Some(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The bug this guards: a 320k HE-AAC Icecast mount advertising the legacy
    // `audio/aacp` reached WebView2 unchanged and would not play, because that
    // spelling is unsupported there. macOS is the one webview that needs it kept.
    #[test]
    fn legacy_aacp_is_modernised_everywhere_except_macos() {
        let got = webview_content_type("audio/aacp");
        if cfg!(target_os = "macos") {
            // Pins CURRENT behaviour, not a capability: WKWebView plays both
                // spellings (measured 2026-08-25). See the fn's doc comment.
                assert_eq!(got, "audio/aacp", "macOS arm keeps the legacy spelling");
        } else {
            assert_eq!(got, "audio/aac", "webkit2gtk + WebView2 need the modern one");
        }
    }

    #[test]
    fn the_remap_is_case_insensitive() {
        // Header values are not normalised upstream; Shoutcast-era servers vary.
        let got = webview_content_type("Audio/AACP");
        let want = if cfg!(target_os = "macos") { "Audio/AACP" } else { "audio/aac" };
        assert_eq!(got, want);
    }

    #[test]
    fn every_other_content_type_passes_through_untouched() {
        // Only `audio/aacp` is special — notably `audio/aac` (SomaFM's AAC mount)
        // must NOT be rewritten into the legacy spelling on any platform.
        for ct in ["audio/aac", "audio/mpeg", "audio/ogg", "application/octet-stream"] {
            assert_eq!(webview_content_type(ct), ct);
        }
    }
}
