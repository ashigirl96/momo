// Minimal egress probe for the Bun runner image (no python). IP literals only, because the
// sidecar's DNS answers every name with 127.0.0.1. Prints <check>\t<REACHED|BLOCKED>\t<detail>.
import { connect } from "node:net";

const E = process.env;
const out = (n: string, s: string, d = "") => console.log(`${n}\t${s}\t${d}`);
function tcp(name: string, opts: object): Promise<void> {
  return new Promise((res) => {
    const s = connect(opts as any);
    const t = setTimeout(() => { out(name, "BLOCKED", "timeout"); s.destroy(); res(); }, 2000);
    s.once("connect", () => { s.once("data", (d) => { clearTimeout(t); out(name, "REACHED", JSON.stringify(String(d).slice(0, 20))); s.destroy(); res(); });
      setTimeout(() => { clearTimeout(t); out(name, "REACHED", "(connected)"); s.destroy(); res(); }, 1000); });
    s.once("error", (e: any) => { clearTimeout(t); out(name, "BLOCKED", e.code ?? String(e)); res(); });
  });
}
out("env.uid", "INFO", String(process.getuid?.()));
await tcp("gw.uds", { path: "/run/gw.sock" });
await tcp("gw.shim_lo", { host: "127.0.0.1", port: 8080 });
for (const [n, h, p] of [["direct.v4", "1.1.1.1", 443], ["direct.v6", "2606:4700:4700::1111", 443], ["host.v4lo.gw_tcp", "127.0.0.1", 47300],
  ["host.v6lo.decoy_lo", "::1", 47301], ["host.192.168.64.1", "192.168.64.1", 47302], ["host.192.168.65.254", "192.168.65.254", 47302],
  ["host.lan.decoy_any", E.LAN_IP ?? "", 47302], ["private.router.80", E.ROUTER_IP ?? "", 80], ["meta.169.254.169.254", "169.254.169.254", 80]] as const) {
  if (h) await tcp(n, { host: h, port: p });
}
process.exit(0);
