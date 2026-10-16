"""Binds the Gateway's TCP port on another address and answers SPOOF:<addr>."""
import socket, sys
fam = socket.AF_INET6 if ":" in sys.argv[1] else socket.AF_INET
s = socket.socket(fam, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
if fam == socket.AF_INET6:
    s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
s.bind((sys.argv[1], int(sys.argv[2]))); s.listen(8)
print("bound", sys.argv[1], flush=True)
while True:
    c, _ = s.accept(); c.sendall(f"SPOOF:{sys.argv[1]}\n".encode()); c.close()
