import type { Server } from "bun";
import { rmSync } from "node:fs";

export type Handler = (req: Request, server: Server<undefined>) => Response | Promise<Response>;

export class PortInUseError extends Error {
  constructor(
    readonly port: number,
    readonly holder: string | undefined,
  ) {
    super(
      `port ${port} is in use${holder ? ` by ${holder}` : ""}. momo needs this port to keep its origin; stop that process.`,
    );
    this.name = "PortInUseError";
  }
}

function portHolder(port: number): string | undefined {
  const lsof = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { stderr: "ignore" });
  const fields = lsof.stdout.toString().split("\n");
  const pid = fields.find((f) => f.startsWith("p"))?.slice(1);
  const command = fields.find((f) => f.startsWith("c"))?.slice(1);
  return pid ? `${command ?? "unknown"} (pid ${pid})` : undefined;
}

function isAddressInUse(error: unknown): boolean {
  return (error as { code?: string }).code === "EADDRINUSE";
}

// momo.localhost resolves to ::1 first, so another process on [::1]:port alone would receive our traffic.
const LOOPBACKS = ["127.0.0.1", "::1"] as const;

export function listenLoopback(port: number, fetch: Handler): { port: number; stop(): Promise<void> } {
  for (let attempt = 0; ; attempt++) {
    const servers: Server<undefined>[] = [];
    try {
      for (const hostname of LOOPBACKS) {
        servers.push(Bun.serve({ hostname, port: servers[0]?.port ?? port, fetch }));
      }
      const bound = servers[0]!.port!;
      return {
        port: bound,
        async stop() {
          await Promise.all(servers.map((s) => s.stop(true)));
        },
      };
    } catch (error) {
      for (const s of servers) s.stop(true);
      if (!isAddressInUse(error)) throw error;
      if (port === 0 && attempt < 5) continue;
      const taken = servers[0]?.port ?? port;
      throw new PortInUseError(taken, portHolder(taken));
    }
  }
}

export function listenUnixSocket(path: string, fetch: Handler): { stop(): Promise<void> } {
  rmSync(path, { force: true });
  // Bun creates the socket with the process umask; setting it here makes the socket 0600 with no chmod race.
  const previous = process.umask(0o177);
  try {
    const server = Bun.serve({ unix: path, fetch });
    return {
      async stop() {
        await server.stop(true);
      },
    };
  } finally {
    process.umask(previous);
  }
}
