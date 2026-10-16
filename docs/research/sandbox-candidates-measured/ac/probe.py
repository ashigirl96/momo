"""Egress probe run inside a sandbox. Prints one TSV line per check:
<check>\t<REACHED|BLOCKED|SENT|INFO>\t<detail>

REACHED means a peer answered; BLOCKED means the attempt failed before any peer
answered. SENT is for UDP sends that left the socket without an answer to wait for.
Settings come from environment variables so the same file runs in every candidate.
"""
import os
import random
import socket
import string
import struct
import subprocess
import sys

E = os.environ
TIMEOUT = float(E.get("PROBE_TIMEOUT", "3"))
LAN_IP = E.get("LAN_IP", "")
ROUTER_IP = E.get("ROUTER_IP", "")
GW_UDS = E.get("GW_UDS", "")
SHIM_PORT = int(E.get("SHIM_PORT", "0"))
GW_TCP = int(E.get("GW_TCP", "0"))
DECOY_LO = int(E.get("DECOY_LO", "0"))
DECOY_ANY = int(E.get("DECOY_ANY", "0"))
DECOY_UDP = int(E.get("DECOY_UDP", "0"))
VSOCK_SCAN = E.get("VSOCK_SCAN", "") == "1"


def out(name, status, detail=""):
    print(f"{name}\t{status}\t{detail}".replace("\n", " "), flush=True)


def err(e):
    return f"{type(e).__name__}: {e}"


def tcp_banner(host, port, family=None):
    infos = socket.getaddrinfo(host, port, family or 0, socket.SOCK_STREAM)
    last = None
    for fam, typ, proto, _, addr in infos:
        s = socket.socket(fam, typ, proto)
        s.settimeout(TIMEOUT)
        try:
            s.connect(addr)
            try:
                data = s.recv(64)
            except socket.timeout:
                data = b"(connected, no banner)"
            return f"{addr[0]} -> {data!r}"
        except OSError as e:
            last = e
        finally:
            s.close()
    raise last


def check_tcp(name, host, port, family=None):
    try:
        out(name, "REACHED", tcp_banner(host, port, family))
    except OSError as e:
        out(name, "BLOCKED", err(e))


def dns_query(qname):
    qid = random.randint(0, 0xFFFF)
    header = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    q = b"".join(bytes([len(p)]) + p.encode() for p in qname.split(".")) + b"\x00"
    return header + q + struct.pack(">HH", 1, 1)


def check_dns_udp(name, server):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(TIMEOUT)
        s.sendto(dns_query("example.com"), (server, 53))
        data, _ = s.recvfrom(512)
        out(name, "REACHED", f"{len(data)}B answer")
    except OSError as e:
        out(name, "BLOCKED", err(e))


def check_dns_tcp(name, server):
    try:
        s = socket.create_connection((server, 53), timeout=TIMEOUT)
        q = dns_query("example.com")
        s.sendall(struct.pack(">H", len(q)) + q)
        data = s.recv(512)
        out(name, "REACHED", f"{len(data)}B answer")
    except OSError as e:
        out(name, "BLOCKED", err(e))


def check_udp_send(name, host, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.sendto(b"momo-egress-probe " + name.encode(), (host, port))
        out(name, "SENT", "datagram left the socket; check the host log for arrival")
    except OSError as e:
        out(name, "BLOCKED", err(e))


def check_gai(name, host):
    try:
        addrs = sorted({i[4][0] for i in socket.getaddrinfo(host, 443, 0, socket.SOCK_STREAM)})
        out(name, "REACHED", ",".join(addrs))
    except socket.gaierror as e:
        out(name, "BLOCKED", err(e))


def check_uds(name, path):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(TIMEOUT)
    try:
        s.connect(path)
        out(name, "REACHED", repr(s.recv(64)))
    except OSError as e:
        out(name, "BLOCKED", err(e))
    finally:
        s.close()


def check_ping(name, host):
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", host], capture_output=True, text=True, timeout=10)
        status = "REACHED" if r.returncode == 0 else "BLOCKED"
        out(name, status, (r.stdout + r.stderr).strip()[-160:])
    except (OSError, subprocess.TimeoutExpired) as e:
        out(name, "BLOCKED", err(e))


def interfaces():
    if not os.path.isdir("/sys/class/net"):
        return
    out("net.ifaces", "INFO", ",".join(sorted(os.listdir("/sys/class/net"))))
    for f in ("/proc/net/if_inet6", "/proc/net/route", "/etc/resolv.conf"):
        try:
            with open(f) as fh:
                out("net." + os.path.basename(f), "INFO", fh.read().strip() or "(empty)")
        except OSError as e:
            out("net." + os.path.basename(f), "INFO", err(e))


def vsock_scan():
    if not hasattr(socket, "AF_VSOCK"):
        out("vsock.scan", "INFO", "AF_VSOCK unavailable")
        return
    for cid in (1, 2, 3):
        hits = []
        first_err = None
        for port in range(0, 65536):
            s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
            s.settimeout(0.5)
            try:
                s.connect((cid, port))
                hits.append(port)
            except OSError as e:
                first_err = first_err or err(e)
            finally:
                s.close()
        out(f"vsock.cid{cid}", "REACHED" if hits else "BLOCKED",
            f"open ports {hits[:20]}" if hits else f"none in 0-65535 ({first_err})")


def main():
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"):
        if k in E:
            out("env." + k, "INFO", E[k])
    out("env.uid", "INFO", str(os.getuid()))
    interfaces()

    if GW_UDS:
        check_uds("gw.uds", GW_UDS)
    if SHIM_PORT:
        check_tcp("gw.shim_lo", "127.0.0.1", SHIM_PORT)
    if GW_TCP:
        check_tcp("gw.tcp_localhost", "127.0.0.1", GW_TCP)

    rnd = "".join(random.choice(string.ascii_lowercase) for _ in range(16))
    check_gai("dns.gai.known", "example.com")
    check_gai("dns.gai.unique", f"momo-{rnd}.example.com")
    check_dns_udp("dns.udp.1.1.1.1", "1.1.1.1")
    check_dns_udp("dns.udp.8.8.8.8", "8.8.8.8")
    check_dns_tcp("dns.tcp.1.1.1.1", "1.1.1.1")

    check_tcp("direct.hostname.443", "example.com", 443)
    check_tcp("direct.v4literal.443", "1.1.1.1", 443)
    check_tcp("direct.v6literal.443", "2606:4700:4700::1111", 443)

    check_udp_send("udp.quic.1.1.1.1:443", "1.1.1.1", 443)
    check_ping("icmp.1.1.1.1", "1.1.1.1")

    hosts = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "host.docker.internal",
             "gateway.docker.internal", "192.168.65.254", "192.168.64.1", "host.lima.internal"]
    if LAN_IP:
        hosts.append(LAN_IP)
    for h in hosts:
        for label, port in (("decoy_lo", DECOY_LO), ("decoy_any", DECOY_ANY), ("gw_tcp", GW_TCP)):
            if port:
                check_tcp(f"host.{h}.{label}", h, port)
    if DECOY_UDP:
        for h in ("host.docker.internal", "192.168.64.1", LAN_IP):
            if h:
                try:
                    check_udp_send(f"udp.host.{h}", socket.gethostbyname(h), DECOY_UDP)
                except OSError as e:
                    out(f"udp.host.{h}", "BLOCKED", err(e))

    check_tcp("meta.169.254.169.254.80", "169.254.169.254", 80)
    if ROUTER_IP:
        check_tcp("private.router.80", ROUTER_IP, 80)
    check_tcp("private.10.0.0.1.80", "10.0.0.1", 80)

    if VSOCK_SCAN:
        vsock_scan()


if __name__ == "__main__":
    sys.exit(main())
