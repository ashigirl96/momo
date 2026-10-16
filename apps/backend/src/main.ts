import { DEFAULT_PORT, defaultDataDir } from "@momo/contracts";
import { MigrationError } from "@momo/migrator";
import { homedir } from "node:os";
import { startBackend } from "./backend.ts";
import { PortInUseError } from "./listen.ts";

const dataDir = process.env.MOMO_DATA_DIR ?? defaultDataDir(homedir());
const port = process.env.MOMO_PORT ? Number(process.env.MOMO_PORT) : DEFAULT_PORT;

try {
  const backend = await startBackend({ dataDir, port });
  console.log(`momo backend on ${backend.origin} (data: ${dataDir})`);
  if (backend.warnings.some((w) => w.kind === "filevault_off")) {
    console.warn("warning: FileVault is off, so app.db is not encrypted at rest.");
  }
  void backend.timeMachineExcluded.then(() => {
    if (backend.warnings.some((w) => w.kind === "time_machine_not_excluded")) {
      console.warn(`warning: could not exclude ${dataDir} from Time Machine.`);
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void backend.stop().then(() => process.exit(0)));
  }
} catch (error) {
  if (error instanceof MigrationError || error instanceof PortInUseError) {
    console.error(`momo backend did not start: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
