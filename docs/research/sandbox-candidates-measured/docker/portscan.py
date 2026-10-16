"""Scan TCP ports on one IP from inside a sandbox; prints open and timed-out ports."""
import socket, sys, concurrent.futures as cf
host = sys.argv[1]; lo, hi = int(sys.argv[2]), int(sys.argv[3])
def one(p):
    s = socket.socket(); s.settimeout(0.5)
    try:
        s.connect((host, p)); return (p, "open")
    except socket.timeout: return (p, "timeout")
    except OSError as e: return (p, None if e.errno == 111 else f"errno{e.errno}")
    finally: s.close()
res = {}
with cf.ThreadPoolExecutor(128) as ex:
    for p, st in ex.map(one, range(lo, hi + 1)):
        if st: res.setdefault(st, []).append(p)
for st, ps in res.items():
    print(f"{host}\t{st}\t{len(ps)}\t{ps[:60]}")
