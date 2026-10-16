import { HOSTNAME, pairingSocketPath, type Pairing, type Warning } from "@momo/contracts";
import { migrate, openDatabase } from "@momo/migrator";
import { AttachmentFiles } from "@momo/agent";
import { sweepAttachmentFiles } from "@momo/agent/startup";
import { buildWeb, type WebAsset } from "@momo/web/build";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { join } from "node:path";
import { ConversationHub } from "./conversation-hub.ts";
import { prepareDataDir, macProbes, type HostProbes } from "./data-dir.ts";
import { appDbDomains } from "./domains.ts";
import { FakeRunner } from "./fake-runner.ts";
import { RunLoop } from "./run-loop.ts";
import { createApp } from "./http/app.ts";
import { listenLoopback, listenUnixSocket } from "./listen.ts";
import { PairingTokens } from "./pairing.ts";

export type BackendOptions = {
  dataDir: string;
  /** 0 picks a free port, for tests. */
  port: number;
  socketPath?: string;
  probes?: HostProbes;
  now?: () => Date;
  /** Pause between the fake runner's stream deltas. */
  fakeRunnerDelayMs?: number;
  /** How often an open SSE stream re-checks its Login and Workspace. */
  streamCheckMs?: number;
};

export type Backend = {
  port: number;
  host: string;
  origin: string;
  socketPath: string;
  warnings: Warning[];
  /** Settles when the data dir is out of Time Machine, or the attempt failed. */
  timeMachineExcluded: Promise<void>;
  stop(): Promise<void>;
};

let web: Promise<Map<string, WebAsset>> | undefined;
const webAssets = () => (web ??= buildWeb());

/**
 * Starts the backend, or throws without listening when app.db cannot be used
 * (MigrationError) or the port is taken (PortInUseError).
 */
export async function startBackend(options: BackendOptions): Promise<Backend> {
  const now = options.now ?? (() => new Date());
  const socketPath = options.socketPath ?? pairingSocketPath(options.dataDir);
  const { warnings, excluded } = await prepareDataDir(options.dataDir, options.probes ?? macProbes);

  const sqlite = openDatabase(join(options.dataDir, "app.db"));
  const stops: (() => Promise<void> | void)[] = [() => sqlite.close()];
  const stop = async () => {
    for (const fn of stops.splice(0).toReversed()) await fn();
  };

  try {
    migrate(sqlite, appDbDomains);
    const db = drizzle({ client: sqlite });
    const hub = new ConversationHub();
    const runs = new RunLoop({
      db,
      hub,
      now,
      runner: new FakeRunner({ delayMs: options.fakeRunnerDelayMs ?? 60 }),
    });
    stops.push(() => {
      runs.stop();
      hub.closeAll();
    });
    runs.recover();
    const attachments = new AttachmentFiles(join(options.dataDir, "attachments"));
    // Before listening, so no upload is between writing its file and committing its row.
    sweepAttachmentFiles(db, attachments);
    const assets = await webAssets();
    const pairing = new PairingTokens(now);
    let host = "";
    let origin = "";
    const app = createApp({
      db,
      runs,
      hub,
      attachments,
      streamCheckMs: options.streamCheckMs ?? 5000,
      pairing,
      now,
      warnings,
      assets,
      host: () => host,
      origin: () => origin,
    });

    const tcp = listenLoopback(options.port, app);
    stops.push(() => tcp.stop());
    host = `${HOSTNAME}:${tcp.port}`;
    origin = `http://${host}`;

    const uds = listenUnixSocket(socketPath, (req) => {
      if (new URL(req.url).pathname !== "/pairing" || req.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const { token, expiresAt } = pairing.issue();
      return Response.json({
        url: `${origin}/pair#${token}`,
        expiresAt: expiresAt.getTime(),
      } satisfies Pairing);
    });
    stops.push(() => uds.stop());

    return { port: tcp.port, host, origin, socketPath, warnings, timeMachineExcluded: excluded, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
