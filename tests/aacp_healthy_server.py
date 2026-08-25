#!/usr/bin/env python3
"""A HEALTHY `audio/aacp` stream on localhost — the missing ingredient for verifying
the legacy-MIME remap (`webview_content_type`, proxy.rs) on all three platforms.

WHY THIS EXISTS
    `1249ed6` made the proxy modernise the Shoutcast-era `audio/aacp` to `audio/aac`
    for every webview except WKWebView. Its Needs-verify asked macOS and Linux to
    "confirm an audio/aacp station still plays" — and macOS correctly refused to
    answer, because the only aacp mounts anyone has are the two 320k mounts that
    underdeliver at 0.07-0.12x realtime. They fail for reasons that have NOTHING to
    do with the MIME spelling, so a naive check reports a false regression
    (docs/macos-track-data-2026-08-25.md §4).

    This removes the confound: healthy delivery, from localhost, with the MIME as
    the ONLY variable.

HOW
    Captures a few seconds of real ADTS AAC from a well-behaved upstream ONCE at
    startup, trims to the first frame boundary, then serves that buffer on a loop,
    paced to roughly realtime. Nothing is written to disk and no audio is committed
    to the repo — the bytes are borrowed at runtime and live only in memory.

USAGE
    python3 tests/aacp_healthy_server.py                  # serves audio/aacp on :8801
    python3 tests/aacp_healthy_server.py --content-type audio/aac    # the A/B control
    python3 tests/aacp_healthy_server.py --port 8899 --seconds 12

    Then point ntune at http://127.0.0.1:8801/ — as a station, or straight through
    the proxy: http://127.0.0.1:<proxyPort>/?url=http%3A%2F%2F127.0.0.1%3A8801%2F

    A/B is the whole point: `audio/aacp` and `audio/aac` serve BYTE-IDENTICAL audio,
    so if one plays and the other does not, the MIME spelling is the only thing that
    can explain it.

EXPECTED
    macOS/WKWebView   both play (it accepts the legacy spelling; the remap is a no-op)
    Windows/WebView2  both play WITH the fix; without it, audio/aacp fails and
                      audio/aac plays — which is exactly the bug 1249ed6 fixed
    Linux/webkit2gtk  as Windows

Stdlib only, like radioscan.py.
"""
import argparse
import socket
import sys
import threading
import time
import urllib.request

# A mount that is genuinely well-behaved. It serves `audio/aac`; we relabel it, which
# is the point — the audio is held constant so the MIME is the only variable.
DEFAULT_UPSTREAM = "https://ice1.somafm.com/groovesalad-128-aac"
# SomaFM refuses some clients on User-Agent (a plain curl gets an empty reply), so
# identify like a normal player.
UA = "ntune-test (radio-scan)"

SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000,
                24000, 22050, 16000, 12000, 11025, 8000, 7350, 0, 0, 0]


def adts_scan(buf):
    """(frames, seconds, sample_rate, first_sync_offset) for a raw ADTS buffer.

    An AAC core frame is 1024 samples, so duration comes from the frame COUNT and the
    sample rate — never from bytes/second, which on a starved stream measures delivery
    rather than the encoding (the trap macOS documented after falling into it)."""
    i, first, frames, sr = 0, -1, 0, 0
    while i + 7 < len(buf):
        if buf[i] == 0xFF and (buf[i + 1] & 0xF0) == 0xF0:
            length = ((buf[i + 3] & 0x03) << 11) | (buf[i + 4] << 3) | (buf[i + 5] >> 5)
            if length < 7 or i + length > len(buf):
                break
            if first < 0:
                first = i
                sr = SAMPLE_RATES[(buf[i + 2] >> 2) & 0x0F] or 0
            frames += 1
            i += length
        else:
            i += 1
    return frames, (frames * 1024 / sr if sr else 0.0), sr, first


def capture(upstream, seconds):
    """Pull from `upstream` until we hold `seconds` of decodable audio."""
    print(f"capturing ~{seconds}s of ADTS from {upstream} …", flush=True)
    req = urllib.request.Request(upstream, headers={"User-Agent": UA})
    buf = bytearray()
    with urllib.request.urlopen(req, timeout=20) as r:
        ctype = r.headers.get("Content-Type", "?")
        print(f"  upstream Content-Type: {ctype}", flush=True)
        deadline = time.time() + max(seconds * 4, 30)
        while time.time() < deadline:
            chunk = r.read(8192)
            if not chunk:
                break
            buf.extend(chunk)
            _, dur, _, _ = adts_scan(buf)
            if dur >= seconds:
                break
    frames, dur, sr, first = adts_scan(buf)
    if frames == 0 or first < 0:
        sys.exit("no ADTS frames found upstream — is that mount really AAC?")
    # Start on a frame boundary so the first bytes a decoder sees are a valid header.
    body = bytes(buf[first:])
    frames, dur, sr, _ = adts_scan(body)
    print(f"  captured {len(body)} bytes = {frames} frames = {dur:.2f}s @ {sr} Hz", flush=True)
    return body, dur


def serve(body, duration, port, content_type, kbps=None):
    bps = len(body) / duration if duration else 40000  # bytes/sec at realtime
    if kbps:
        # Deliberate starvation, for reproducing the OTHER failure mode: a stream
        # arriving below realtime. Chromium can sniff a healthy stream's codec and
        # play it whatever the MIME says, so starvation is the condition under which
        # the declared Content-Type actually decides the outcome. This is what makes
        # the aacp remap testable without depending on a flaky third-party mount.
        bps = kbps * 1000 / 8
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(8)
    print(f"\nserving {content_type} on http://127.0.0.1:{port}/  "
          f"(looping {duration:.1f}s, ~{bps*8/1000:.0f} kbps)\nCtrl-C to stop.", flush=True)

    def client(conn):
        try:
            conn.recv(4096)  # request line + headers; we serve one thing regardless
            conn.sendall(
                f"HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n"
                "Cache-Control: no-store\r\nConnection: close\r\n\r\n".encode()
            )
            # Pace slightly above realtime: enough headroom that the player never
            # starves (the whole point), without flooding its buffer.
            headroom = 1.0 if kbps else 1.3
            chunk, step = 4096, 4096 / (bps * headroom)
            while True:
                for off in range(0, len(body), chunk):
                    conn.sendall(body[off:off + chunk])
                    time.sleep(step)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    while True:
        conn, _ = srv.accept()
        threading.Thread(target=client, args=(conn,), daemon=True).start()


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--upstream", default=DEFAULT_UPSTREAM, help="healthy AAC source to borrow")
    p.add_argument("--content-type", default="audio/aacp",
                   help="what to advertise (use audio/aac for the A/B control)")
    p.add_argument("--port", type=int, default=8801)
    p.add_argument("--seconds", type=float, default=8.0, help="how much audio to loop")
    p.add_argument("--kbps", type=float, default=None,
                   help="throttle delivery to this rate, to reproduce a STARVED stream")
    a = p.parse_args()
    body, dur = capture(a.upstream, a.seconds)
    try:
        serve(body, dur, a.port, a.content_type, a.kbps)
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
