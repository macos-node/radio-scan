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

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Start the loopback proxy on its OWN thread + tokio runtime and return the
/// bound port. Self-contained so it never depends on Tauri's async runtime
/// (nested spawns on which were leaving connections unhandled).
pub fn start() -> std::io::Result<u16> {
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
                            tokio::spawn(handle(sock));
                        }
                        Err(_) => break,
                    }
                }
            });
        })?;
    rx.recv()
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "proxy thread exited"))?
}

async fn handle(mut client: TcpStream) {
    let target = read_target(&mut client).await;
    let Some((authority, path)) = target.as_deref().and_then(split_http_url) else {
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

    // HTTP/1.0 + Connection: close = stream the body until the connection drops,
    // which is exactly how Icecast serves an endless stream. No Icy-MetaData, so
    // the upstream sends pure audio (metadata is a U3 concern).
    let host = authority.split(':').next().unwrap_or(&authority);
    let req = format!(
        "GET {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: ntune (radio-scan)\r\nConnection: close\r\n\r\n"
    );
    if upstream.write_all(req.as_bytes()).await.is_err() {
        return;
    }

    // Read the upstream's response head, then send our OWN clean HTTP/1.1 head to
    // the webview — its media loader is fussier than curl about HTTP/1.0 +
    // Connection: Close — and relay the body from there.
    let Some((content_type, body_head)) = read_upstream_head(&mut upstream).await else {
        let _ = client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
            .await;
        return;
    };
    // webkit2gtk's media loader refuses the legacy SHOUTcast `audio/aacp` MIME
    // (HE-AAC / aacPlus) even though the payload is ordinary decodable AAC —
    // normalize it to the standard `audio/aac` it accepts. Harmless on macOS
    // WKWebView, which accepts either. Only this alias is remapped; everything
    // else passes through untouched.
    let content_type = if content_type.eq_ignore_ascii_case("audio/aacp") {
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
    if !body_head.is_empty() && client.write_all(&body_head).await.is_err() {
        return;
    }
    let _ = tokio::io::copy(&mut upstream, &mut client).await;
}

/// Read the upstream HTTP response head; return (Content-Type, any body bytes
/// already buffered past the `\r\n\r\n` header terminator).
async fn read_upstream_head(up: &mut TcpStream) -> Option<(String, Vec<u8>)> {
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
            let content_type = head
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-type"))
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_else(|| "application/octet-stream".to_string());
            return Some((content_type, buf[pos + 4..].to_vec()));
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
