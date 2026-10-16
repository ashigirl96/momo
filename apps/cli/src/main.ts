#!/usr/bin/env bun
import { defaultDataDir, Pairing, pairingSocketPath } from "@momo/contracts";
import { homedir } from "node:os";

const USAGE = "usage: momo open [--print]";

async function requestPairing(socketPath: string): Promise<Pairing | undefined> {
  try {
    const res = await fetch("http://localhost/pairing", { method: "POST", unix: socketPath });
    if (!res.ok) return undefined;
    return Pairing.parse(await res.json());
  } catch {
    return undefined;
  }
}

async function open(args: string[]): Promise<number> {
  const dataDir = process.env.MOMO_DATA_DIR ?? defaultDataDir(homedir());
  const pairing = await requestPairing(pairingSocketPath(dataDir));
  if (!pairing) {
    console.error(
      "momo: the backend is not running. Start it with `bun run start`, then run `momo open` again.",
    );
    return 1;
  }
  if (args.includes("--print")) {
    console.log(pairing.url);
    return 0;
  }
  // The URL is passed as an argument, never through a shell, and the token stays in the fragment.
  return Bun.spawnSync(["open", pairing.url]).exitCode;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "open") {
  process.exit(await open(rest));
}
console.error(USAGE);
process.exit(2);
