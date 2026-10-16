"""Times a NanoClaw-shaped session bring-up: per-session network, relay, agent reaching the Gateway."""
import subprocess, time, statistics as st, sys
IMG = "momo-cmp-d-probe:1"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
def run(*a): subprocess.run(a, check=True, capture_output=True)
rows = []
for i in range(N):
    net, relay, agent = f"momo-cmp-d-t{i}", f"momo-cmp-d-t{i}-relay", f"momo-cmp-d-t{i}-agent"
    t0 = time.time()
    run("docker", "network", "create", "--internal", "-o", "com.docker.network.bridge.gateway_mode_ipv4=isolated",
        "--subnet", f"10.214.{i}.0/29", net)
    t1 = time.time()
    run("docker", "run", "-d", "--name", relay, "--network", "bridge", "--read-only", "--cap-drop=ALL", "--init", IMG,
        "socat", "TCP-LISTEN:3129,fork,reuseaddr", "TCP:host.docker.internal:47200")
    run("docker", "network", "connect", "--alias", "gateway", net, relay)
    t2 = time.time()
    run("docker", "run", "-d", "--name", agent, "--network", net, "--cap-drop=ALL", "--security-opt", "no-new-privileges",
        "--init", "--user", "1000:1000", "--read-only", IMG, "sleep", "infinity")
    t3 = time.time()
    run("docker", "exec", agent, "python3", "-c",
        "import socket;s=socket.create_connection(('gateway',3129),timeout=5);assert s.recv(5)==b'GW-OK'")
    t4 = time.time()
    run("docker", "rm", "-f", agent, relay); run("docker", "network", "rm", net)
    t5 = time.time()
    rows.append((t1 - t0, t2 - t1, t3 - t2, t4 - t3, t4 - t0, t5 - t4))
for i, label in enumerate(["network", "relay run+connect", "agent run", "first Gateway round trip", "total to ready", "teardown"]):
    v = [r[i] for r in rows]
    print(f"{label}: median {st.median(v):.2f}s  max {max(v):.2f}s")
