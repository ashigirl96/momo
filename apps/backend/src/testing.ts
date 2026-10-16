import { Pairing } from "@momo/contracts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackend, type Backend, type BackendOptions } from "./backend.ts";

export type TestBackend = Backend & {
  dataDir: string;
  /** Sends a request the way the momo UI in a browser would; override headers to forge one. */
  call(path: string, init?: CallInit): Promise<Response>;
  /** Runs the `momo open` pairing and returns the Login cookie header value. */
  login(userAgent?: string): Promise<string>;
  pairing(): Promise<Pairing>;
  restart(overrides?: Partial<BackendOptions>): Promise<TestBackend>;
  cleanup(): Promise<void>;
};

export type CallInit = {
  method?: string;
  cookie?: string;
  body?: unknown;
  /** A multipart body; fetch sets its content type. */
  form?: FormData;
  headers?: Record<string, string | undefined>;
};

export const quietProbes: BackendOptions["probes"] = {
  fileVaultActive: async () => true,
  timeMachineExcluded: () => true,
  excludeFromTimeMachine: async () => true,
};

export async function startTestBackend(overrides: Partial<BackendOptions> = {}): Promise<TestBackend> {
  // Unix socket paths are limited to 104 bytes on macOS, so keep the data dir short.
  const dataDir = overrides.dataDir ?? mkdtempSync(join(tmpdir(), "momo-"));
  const options: BackendOptions = { dataDir, port: 0, probes: quietProbes, ...overrides };
  const backend = await startBackend(options);

  const call = (path: string, init: CallInit = {}) => {
    const method = init.method ?? "GET";
    const headers: Record<string, string> = {
      host: backend.host,
      "sec-fetch-site": "same-origin",
      "user-agent": "momo-test",
    };
    if (method !== "GET" && method !== "HEAD") headers.origin = backend.origin;
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (value === undefined) delete headers[name];
      else headers[name] = value;
    }
    return fetch(`http://127.0.0.1:${backend.port}${path}`, {
      method,
      headers,
      body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      redirect: "manual",
    });
  };

  const pairing = async () => {
    const res = await fetch("http://localhost/pairing", { method: "POST", unix: backend.socketPath });
    return Pairing.parse(await res.json());
  };

  const handle: TestBackend = {
    ...backend,
    dataDir,
    call,
    pairing,
    async login(userAgent = "momo-test") {
      const token = new URL((await pairing()).url).hash.slice(1);
      const res = await call("/api/pair", {
        method: "POST",
        body: { token },
        headers: { "user-agent": userAgent },
      });
      if (res.status !== 204) throw new Error(`pairing failed with ${res.status}`);
      return res.headers.getSetCookie()[0]!.split(";")[0]!;
    },
    async restart(more = {}) {
      await backend.stop();
      return startTestBackend({ ...overrides, dataDir, port: backend.port, ...more });
    },
    async cleanup() {
      await backend.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return handle;
}
