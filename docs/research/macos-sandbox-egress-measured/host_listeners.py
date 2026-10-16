"""Host-side fixtures: a fake Gateway and decoy listeners that log every hit.

usage: host_listeners.py gw <uds_path> <tcp_port> <log>
       host_listeners.py decoys <lo_port> <any_tcp_port> <any_udp_port> <log>
"""
import os
import socket
import sys
import threading
import time


def log(path, msg):
    with open(path, "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


def serve_stream(sock, banner, logpath, label):
    while True:
        conn, addr = sock.accept()
        log(logpath, f"{label} accept from {addr!r}")
        try:
            conn.sendall(banner)
        finally:
            conn.close()


def serve_udp(sock, logpath, label):
    while True:
        data, addr = sock.recvfrom(2048)
        log(logpath, f"{label} datagram {len(data)}B from {addr!r}")


def tcp(host, port, family=socket.AF_INET):
    s = socket.socket(family, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if family == socket.AF_INET6:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    s.bind((host, port))
    s.listen(16)
    return s


def main():
    mode = sys.argv[1]
    threads = []
    if mode == "gw":
        uds_path, port, logpath = sys.argv[2], int(sys.argv[3]), sys.argv[4]
        if os.path.exists(uds_path):
            os.unlink(uds_path)
        u = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        u.bind(uds_path)
        u.listen(16)
        threads.append((u, b"GW-OK uds\n", "gw-uds"))
        threads.append((tcp("127.0.0.1", port), b"GW-OK tcp\n", "gw-tcp"))
    elif mode == "decoys":
        lo_port, any_port, udp_port, logpath = map(str, sys.argv[2:6])
        threads.append((tcp("127.0.0.1", int(lo_port)), b"DECOY lo\n", "decoy-lo"))
        threads.append((tcp("::1", int(lo_port), socket.AF_INET6), b"DECOY lo6\n", "decoy-lo6"))
        threads.append((tcp("0.0.0.0", int(any_port)), b"DECOY any\n", "decoy-any"))
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.bind(("0.0.0.0", int(udp_port)))
        threading.Thread(target=serve_udp, args=(udp, logpath, "decoy-udp"), daemon=True).start()
    else:
        sys.exit(f"unknown mode {mode}")
    for sock, banner, label in threads:
        threading.Thread(target=serve_stream, args=(sock, banner, logpath, label), daemon=True).start()
    log(logpath, f"{mode} listening")
    print(f"{mode} ready", flush=True)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
