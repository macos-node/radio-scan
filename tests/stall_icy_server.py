#!/usr/bin/env python3
"""A deliberately hostile ICY server: connects, sends valid headers, then stalls.

This is the condition the between-blocks stop check cannot survive — the client
blocks INSIDE read_exactly() rather than between blocks, so the flag is never
looked at. Reported from macOS (06ec7f9); this is the Linux reproduction.

    python3 stallserver.py [port] [--after N]

--after N sends N metaint blocks (each with one metadata update) before going
silent, so the client gets far enough to be logging happily first.
"""
import socket
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else 8999
AFTER = 0
if "--after" in sys.argv:
    AFTER = int(sys.argv[sys.argv.index("--after") + 1])

METAINT = 8192


def serve(conn):
    conn.recv(4096)  # the request; contents don't matter
    conn.sendall(
        b"HTTP/1.0 200 OK\r\n"
        b"Content-Type: audio/mpeg\r\n"
        b"icy-name: Stall Test\r\n"
        b"icy-br: 128\r\n"
        b"icy-metaint: %d\r\n\r\n" % METAINT
    )
    for i in range(AFTER):
        conn.sendall(b"\x00" * METAINT)
        meta = b"StreamTitle='Stall Test - track %d';" % i
        pad = (-len(meta)) % 16
        conn.sendall(bytes([(len(meta) + pad) // 16]) + meta + b"\x00" * pad)
    # …and now nothing, forever. The socket stays OPEN — this is a stall, not a
    # disconnect, so the client sits in a blocking read with no error to catch.
    print(f"stalling after {AFTER} block(s); socket held open", flush=True)
    while True:
        threading.Event().wait(60)


s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", PORT))
s.listen(5)
print(f"stall server on 127.0.0.1:{PORT}", flush=True)
while True:
    conn, _ = s.accept()
    threading.Thread(target=serve, args=(conn,), daemon=True).start()
