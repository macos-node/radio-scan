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

async fn handle(mut client: TcpStream, app: AppHandle) {
    let target = read_target(&mut client).await;
    let Some((authority, path)) = target.as_deref().and_then(split_http_url) else {
        let _ = client
            .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            .await;
        return;
    };
    let upstream_url = target.unwrap_or_default();

    let mut upstream = match TcpStream::connect(authority.as_str()).await {
        Ok(s) => s,
        Err(_) => {
            let _ = client
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                .await;
            return;
        }
    };

    // Ask for inline ICY metadata (Icy-MetaData: 1) so we can surface now-playing
    // (U3). HTTP/1.0 + Connection: close = stream the body until the connection
    // drops, which is exactly how Icecast serves an endless stream.
    let host = authority.split(':').next().unwrap_or(&authority);
    let req = format!(
        "GET {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: ntune (radio-scan)\r\nIcy-MetaData: 1\r\nConnection: close\r\n\r\n"
    );
    if upstream.write_all(req.as_bytes()).await.is_err() {
        return;
    }

    // Read the upstream's response head, then send our OWN clean HTTP/1.1 head to
    // the webview — its media loader is fussier than curl about HTTP/1.0 +
    // Connection: Close. When the stream carries inline metadata, it is stripped
    // in relay_icy so the webview only ever sees clean audio.
    let Some((content_type, metaint, body_head)) = read_upstream_head(&mut upstream).await else {
        let _ = client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
            .await;
        return;
    };
    // The two webviews want OPPOSITE MIMEs for the same HE-AAC stream:
    //   • webkit2gtk (Linux) refuses the legacy SHOUTcast `audio/aacp` alias and
    //     needs the standard `audio/aac`.
    //   • WKWebView (macOS) plays `audio/aacp` but FAILS on `audio/aac` for the
    //     same payload.
    // So remap `audio/aacp` -> `audio/aac` on Linux ONLY; pass it through on
    // macOS. Both verified on real hardware 2026-08-04. Only this alias is
    // touched; everything else passes through untouched.
    let content_type = if cfg!(target_os = "linux")
        && content_type.eq_ignore_ascii_case("audio/aacp")
    {
        "audio/aac".to_string()
    } else {
        content_type
    };
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    );
    if client.write_all(resp.as_bytes()).await.is_err() {
        return;
    }

    match metaint {
        // Inline metadata: strip it, relay clean audio, emit now-playing titles.
        Some(n) if n > 0 => {
            relay_icy(&mut upstream, &mut client, n, body_head, &app, &upstream_url).await;
        }
        // No inline metadata: straight passthrough (e.g. many MP3 streams, or
        // servers that ignored Icy-MetaData). Audio still plays; no now-playing.
        _ => {
            if !body_head.is_empty() && client.write_all(&body_head).await.is_err() {
                return;
            }
            let _ = tokio::io::copy(&mut upstream, &mut client).await;
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

/// Read the upstream HTTP response head; return (Content-Type, icy-metaint if the
/// stream carries inline metadata, and any body bytes already buffered past the
/// `\r\n\r\n` header terminator).
async fn read_upstream_head(up: &mut TcpStream) -> Option<(String, Option<usize>, Vec<u8>)> {
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
            let header = |name: &str| {
                head.lines()
                    .filter_map(|l| l.split_once(':'))
                    .find(|(k, _)| k.trim().eq_ignore_ascii_case(name))
                    .map(|(_, v)| v.trim().to_string())
            };
            let content_type =
                header("content-type").unwrap_or_else(|| "application/octet-stream".to_string());
            let metaint = header("icy-metaint").and_then(|v| v.parse::<usize>().ok());
            return Some((content_type, metaint, buf[pos + 4..].to_vec()));
        }
        if buf.len() > 16384 {
            return None;
        }
    }
}

/// "http://host[:port]/path" -> ("host:port", "/path"), defaulting port 80.
/// Returns None for anything that isn't a plain http:// URL.
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
