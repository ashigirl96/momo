import type { Warning } from "@momo/contracts";
import { chmodSync, mkdirSync } from "node:fs";

export type HostProbes = {
  fileVaultActive(): Promise<boolean>;
  timeMachineExcluded(dir: string): boolean;
  excludeFromTimeMachine(dir: string): Promise<boolean>;
};

const EXCLUDE_XATTR = "com.apple.metadata:com_apple_backup_excludeItem";

async function succeeds(cmd: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    return { ok: (await proc.exited) === 0, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export const macProbes: HostProbes = {
  async fileVaultActive() {
    if (process.platform !== "darwin") return true;
    return (await succeeds(["fdesetup", "status"])).stdout.includes("FileVault is On");
  },
  timeMachineExcluded(dir) {
    if (process.platform !== "darwin") return true;
    return (
      Bun.spawnSync(["xattr", "-p", EXCLUDE_XATTR, dir], { stdout: "ignore", stderr: "ignore" }).exitCode ===
      0
    );
  },
  async excludeFromTimeMachine(dir) {
    // The sticky xattr form needs no root and follows the dir if it is moved.
    return (await succeeds(["tmutil", "addexclusion", dir])).ok;
  },
};

export type DataDir = {
  /** Live list: a failed Time Machine exclusion is added when tmutil finishes. */
  warnings: Warning[];
  excluded: Promise<void>;
};

export async function prepareDataDir(dir: string, probes: HostProbes): Promise<DataDir> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const warnings: Warning[] = [];
  if (!(await probes.fileVaultActive())) warnings.push({ kind: "filevault_off" });
  // tmutil takes about 10 s, so only the first start pays for it and startup does not wait.
  const excluded = probes.timeMachineExcluded(dir)
    ? Promise.resolve()
    : probes.excludeFromTimeMachine(dir).then((ok) => {
        if (!ok) warnings.push({ kind: "time_machine_not_excluded" });
      });
  return { warnings, excluded };
}
