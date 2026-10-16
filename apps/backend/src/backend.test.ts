import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { LoginList, Status } from "@momo/contracts";
import { MigrationError } from "@momo/migrator";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortInUseError } from "./listen.ts";
import { quietProbes, startTestBackend, type TestBackend } from "./testing.ts";

const running: TestBackend[] = [];
async function backend(...args: Parameters<typeof startTestBackend>) {
  const b = await startTestBackend(...args);
  running.push(b);
  return b;
}

afterEach(async () => {
  for (const b of running.splice(0)) await b.cleanup();
});

const mode = (path: string) => statSync(path).mode & 0o777;

function corsHeaders(res: Response) {
  return [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));
}

describe("pairing and Login", () => {
  test("momo open gets a one-minute pairing URL on momo.localhost with the token in the fragment", async () => {
    const b = await backend();

    const pairing = await b.pairing();
    const url = new URL(pairing.url);

    expect(url.origin).toBe(`http://momo.localhost:${b.port}`);
    expect(url.pathname).toBe("/pair");
    expect(url.search).toBe("");
    expect(url.hash.length).toBeGreaterThan(20);
  });

  test("the pairing token becomes a host-only, HttpOnly, SameSite=Strict Login cookie", async () => {
    const b = await backend();
    const token = new URL((await b.pairing()).url).hash.slice(1);

    const res = await b.call("/api/pair", { method: "POST", body: { token } });

    expect(res.status).toBe(204);
    const cookie = res.headers.getSetCookie()[0]!;
    const attributes = cookie.split(";").map((a) => a.trim().toLowerCase());
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=strict");
    expect(attributes).toContain("path=/");
    expect(attributes).toContain("max-age=2592000");
    expect(attributes.some((a) => a.startsWith("domain="))).toBe(false);
    expect(cookie).not.toContain(token);

    const status = await b.call("/api/status", { cookie: cookie.split(";")[0] });
    expect(status.status).toBe(200);
  });

  test("a pairing token works once", async () => {
    const b = await backend();
    const token = new URL((await b.pairing()).url).hash.slice(1);

    expect((await b.call("/api/pair", { method: "POST", body: { token } })).status).toBe(204);
    const again = await b.call("/api/pair", { method: "POST", body: { token } });
    expect(again.status).toBe(401);
    expect(again.headers.getSetCookie()).toEqual([]);
  });

  test("a pairing token expires after one minute", async () => {
    let now = new Date("2026-10-01T00:00:00Z");
    const b = await backend({ now: () => now });
    const token = new URL((await b.pairing()).url).hash.slice(1);

    now = new Date(now.getTime() + 60_001);

    expect((await b.call("/api/pair", { method: "POST", body: { token } })).status).toBe(401);
  });

  test("an unknown pairing token is refused", async () => {
    const b = await backend();

    expect((await b.call("/api/pair", { method: "POST", body: { token: "guess" } })).status).toBe(401);
  });

  test("the Login slides: an authenticated request after a while sends the cookie again", async () => {
    let now = new Date("2026-10-01T00:00:00Z");
    const b = await backend({ now: () => now });
    const cookie = await b.login();

    now = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const res = await b.call("/api/status", { cookie });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toStartWith(`${cookie};`);
  });

  test("Logins are listed and a revoked Login stops working", async () => {
    const b = await backend();
    const mine = await b.login("Safari");
    const other = await b.login("Firefox");

    const list = LoginList.parse(await (await b.call("/api/logins", { cookie: mine })).json());
    expect(list.logins.map((l) => [l.userAgent, l.current])).toEqual([
      ["Firefox", false],
      ["Safari", true],
    ]);

    const otherId = list.logins.find((l) => !l.current)!.id;
    expect((await b.call(`/api/logins/${otherId}`, { method: "DELETE", cookie: mine })).status).toBe(204);
    expect((await b.call("/api/status", { cookie: other })).status).toBe(401);
    expect((await b.call(`/api/logins/${otherId}`, { method: "DELETE", cookie: mine })).status).toBe(404);
  });

  test("a Login survives a backend restart", async () => {
    const first = await startTestBackend();
    const cookie = await first.login();

    const second = await first.restart();
    running.push(second);

    expect((await second.call("/api/status", { cookie })).status).toBe(200);
  });
});

describe("request guard", () => {
  test("API requests without a Login are refused", async () => {
    const b = await backend();

    for (const path of ["/api/status", "/api/logins", "/api/events"]) {
      const res = await b.call(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { kind: "unauthenticated" } });
    }
    expect((await b.call("/api/logins/login_x", { method: "DELETE" })).status).toBe(401);
    expect((await b.call("/api/status", { cookie: "momo_login=forged" })).status).toBe(401);
  });

  test("a Host other than momo.localhost:<port> is refused everywhere (DNS rebinding)", async () => {
    const b = await backend();
    const cookie = await b.login();

    for (const host of ["evil.example", `evil.example:${b.port}`, `127.0.0.1:${b.port}`, "momo.localhost"]) {
      for (const path of ["/", "/index.html", "/api/status"]) {
        const res = await b.call(path, { cookie, headers: { host } });
        expect(res.status).toBe(421);
      }
    }
  });

  test("state-changing requests need a same-origin Origin and Sec-Fetch-Site", async () => {
    const b = await backend();
    const cookie = await b.login();
    const token = new URL((await b.pairing()).url).hash.slice(1);
    const forged: Record<string, string | undefined>[] = [
      { origin: undefined },
      { origin: "http://evil.example" },
      { origin: `http://127.0.0.1:${b.port}` },
      { origin: "null" },
      { "sec-fetch-site": undefined },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];

    for (const headers of forged) {
      const pair = await b.call("/api/pair", { method: "POST", body: { token }, headers });
      expect(pair.status).toBe(403);
      const revoke = await b.call("/api/logins/login_x", { method: "DELETE", cookie, headers });
      expect(revoke.status).toBe(403);
    }
    expect((await b.call("/api/pair", { method: "POST", body: { token } })).status).toBe(204);
  });

  test("cross-site reads of the API are refused even with the cookie", async () => {
    const b = await backend();
    const cookie = await b.login();

    const res = await b.call("/api/status", { cookie, headers: { "sec-fetch-site": "cross-site" } });

    expect(res.status).toBe(403);
  });

  test("no response carries CORS headers, preflights included", async () => {
    const b = await backend();
    const cookie = await b.login();
    const evil = { origin: "http://evil.example", "access-control-request-method": "DELETE" };

    const responses = [
      await b.call("/api/status", { cookie, headers: { origin: "http://evil.example" } }),
      await b.call("/api/logins", { method: "OPTIONS", headers: evil }),
      await b.call("/", { headers: { origin: "http://evil.example" } }),
    ];

    for (const res of responses) expect(corsHeaders(res)).toEqual([]);
    expect(responses[1]!.status).toBe(405);
  });
});

describe("UI", () => {
  test("the UI, its assets and the API are served same-origin with CSP and nosniff", async () => {
    const b = await backend();

    const page = await b.call("/");
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toStartWith("text/html");
    const asset = /src="(\/[^"]+\.js)"/.exec(html)![1]!;
    const deep = await b.call("/logins");
    const script = await b.call(asset);
    const api = await b.call("/api/status");

    for (const res of [page, deep, script, api]) {
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(deep.status).toBe(200);
    expect(await deep.text()).toBe(html);
    expect(script.headers.get("content-type")).toStartWith("text/javascript");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  test("unknown API paths are JSON 404s, not the UI", async () => {
    const b = await backend();
    const cookie = await b.login();

    const res = await b.call("/api/nope", { cookie });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { kind: "not_found" } });
  });

  test("the event stream is served same-origin to a Login", async () => {
    const b = await backend();
    const cookie = await b.login();

    const res = await b.call("/api/events", { cookie });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: ready");
    await reader.cancel();
  });
});

describe("startup", () => {
  test("data dir is 0700, app.db and the pairing socket are 0600", async () => {
    const b = await backend();

    expect(mode(b.dataDir)).toBe(0o700);
    expect(mode(join(b.dataDir, "app.db"))).toBe(0o600);
    expect(mode(b.socketPath)).toBe(0o600);
    expect(statSync(b.socketPath).isSocket()).toBe(true);
  });

  test("tightens an existing data dir to 0700", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "momo-"));
    Bun.spawnSync(["chmod", "755", dataDir]);

    const b = await backend({ dataDir });

    expect(mode(b.dataDir)).toBe(0o700);
  });

  test("applies every domain's migrations to app.db", async () => {
    const b = await backend();
    await b.stop();

    const db = new Database(join(b.dataDir, "app.db"), { readonly: true });
    const rows = db.query("SELECT domain FROM momo_migrations").all();
    db.close();
    expect(rows).toContainEqual({ domain: "workspace" });
  });

  test("refuses to start on a database from a newer momo, and leaves the port free", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "momo-"));
    const first = await startTestBackend({ dataDir });
    const port = first.port;
    await first.stop();
    const db = new Database(join(dataDir, "app.db"));
    db.run("INSERT INTO momo_migrations VALUES ('workspace', '29990101000000_future', 'x', 0)");
    db.close();

    const error = await startTestBackend({ dataDir, port }).catch((e) => e);

    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ kind: "unknown_migration" });
    const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() });
    probe.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test.each(["127.0.0.1", "::1"])(
    "stops when the port is taken on %s and says who holds it",
    async (hostname) => {
      const squatter = Bun.serve({ hostname, port: 0, fetch: () => new Response("squatter") });
      try {
        const error = await startTestBackend({ port: squatter.port }).catch((e) => e);

        expect(error).toBeInstanceOf(PortInUseError);
        expect(error.message).toContain(`pid ${process.pid}`);
        expect(error.message).toContain(String(squatter.port));
      } finally {
        squatter.stop(true);
      }
    },
  );

  test("warns in the UI status when FileVault is off", async () => {
    const b = await backend({
      probes: { ...quietProbes!, fileVaultActive: async () => false },
    });
    const cookie = await b.login();

    const status = Status.parse(await (await b.call("/api/status", { cookie })).json());

    expect(status.warnings).toEqual([{ kind: "filevault_off" }]);
  });

  // CI runners may lack a working tmutil; the probe is exercised on the owner's Mac.
  test.skipIf(process.platform !== "darwin" || Boolean(process.env.CI))(
    "excludes the data dir from Time Machine",
    async () => {
      const dataDir = join(mkdtempSync(join(tmpdir(), "momo-")), "data");
      mkdirSync(dataDir);
      const b = await backend({ dataDir, probes: undefined });
      await b.timeMachineExcluded;

      const xattr = Bun.spawnSync([
        "xattr",
        "-p",
        "com.apple.metadata:com_apple_backup_excludeItem",
        b.dataDir,
      ]);
      expect(xattr.exitCode).toBe(0);
      expect(b.warnings).toEqual([]);
    },
    30_000,
  );

  test("warns in the UI status when Time Machine exclusion fails", async () => {
    const b = await backend({
      probes: {
        ...quietProbes!,
        timeMachineExcluded: () => false,
        excludeFromTimeMachine: async () => false,
      },
    });
    await b.timeMachineExcluded;
    const cookie = await b.login();

    const status = Status.parse(await (await b.call("/api/status", { cookie })).json());

    expect(status.warnings).toEqual([{ kind: "time_machine_not_excluded" }]);
  });
});
