// Guest-side helper, run as root before the runner:
// - 127.0.0.1:8080 -> the mounted Gateway socket, so ANTHROPIC_BASE_URL can be plain http on lo.
// - 127.0.0.1:53 answers every A query with 127.0.0.1 and logs the name, so egress attempts become visible.
// - 127.0.0.1:443 and :80 log each connection (and the SNI if present) and close it.
import { appendFileSync } from "node:fs";

const LOG = process.env.LOG_DIR ?? "/log";
const GW = process.env.GW_UDS ?? "/run/gw.sock";
const log = (o: object) => appendFileSync(`${LOG}/sidecar.jsonl`, JSON.stringify({ t: Date.now(), ...o }) + "\n");

type Pair = { peer?: any; pending: Uint8Array[] };
Bun.listen<Pair>({
  hostname: "127.0.0.1",
  port: 8080,
  socket: {
    async open(sock) {
      sock.data = { pending: [] };
      try {
        const up = await Bun.connect<{ down: any }>({
          unix: GW,
          socket: {
            data(u, buf) { u.data.down.write(buf); },
            close(u) { u.data.down.end(); },
            error(u, e) { log({ relay: "upstream-error", e: String(e) }); u.data.down.end(); },
          },
          data: { down: sock },
        });
        sock.data.peer = up;
        for (const b of sock.data.pending) up.write(b);
        sock.data.pending = [];
      } catch (e) {
        log({ relay: "connect-failed", e: String(e) });
        sock.end();
      }
    },
    data(sock, buf) {
      if (sock.data.peer) sock.data.peer.write(buf);
      else sock.data.pending.push(new Uint8Array(buf));
    },
    close(sock) { sock.data.peer?.end(); },
  },
});

for (const port of [443, 80]) {
  Bun.listen({
    hostname: "127.0.0.1",
    port,
    socket: {
      data(sock, buf) {
        const sni = Buffer.from(buf).toString("latin1").match(/[a-z0-9-]+(\.[a-z0-9-]+)+/i)?.[0];
        log({ tcp: port, bytes: buf.byteLength, sni });
        sock.end();
      },
      open() { log({ tcp: port, open: true }); },
    },
  });
}

function parseName(b: Buffer, off: number) {
  const labels: string[] = [];
  while (b[off] !== 0) { const n = b[off]; labels.push(b.subarray(off + 1, off + 1 + n).toString()); off += n + 1; }
  return { name: labels.join("."), end: off + 1 };
}
await Bun.udpSocket({
  hostname: "127.0.0.1",
  port: 53,
  socket: {
    data(sock, buf, port, addr) {
      const b = Buffer.from(buf);
      const { name, end } = parseName(b, 12);
      const qtype = b.readUInt16BE(end);
      log({ dns: name, qtype });
      const q = b.subarray(12, end + 4);
      const header = Buffer.from(b.subarray(0, 12));
      header.writeUInt16BE(0x8180, 2);
      const isA = qtype === 1;
      header.writeUInt16BE(isA ? 1 : 0, 6);
      header.writeUInt16BE(0, 8); header.writeUInt16BE(0, 10);
      const parts = [header, q];
      if (isA) {
        const ans = Buffer.alloc(16);
        ans.writeUInt16BE(0xc00c, 0); ans.writeUInt16BE(1, 2); ans.writeUInt16BE(1, 4); ans.writeUInt32BE(5, 6); ans.writeUInt16BE(4, 10);
        [127, 0, 0, 1].forEach((o, i) => (ans[12 + i] = o));
        parts.push(ans);
      }
      sock.send(Buffer.concat(parts), port, addr);
    },
  },
});
log({ up: true });
console.log("sidecar up");
