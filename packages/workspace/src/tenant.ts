import type { Db } from "@momo/migrator";
import { findWorkspace, type Workspace } from "./workspaces.ts";

export type Actor = { kind: "owner"; loginId: string };

declare const resolved: unique symbol;

/** Only resolveTenant makes one, so an id from a URL, body or LLM argument cannot stand in for it. */
export type TenantContext = {
  readonly workspaceId: string;
  readonly workspace: Workspace;
  readonly actor: Actor;
  readonly [resolved]: true;
};

export function resolveTenant(db: Db, workspaceId: string, actor: Actor): TenantContext | undefined {
  const workspace = findWorkspace(db, workspaceId);
  if (!workspace) return undefined;
  return { workspaceId: workspace.id, workspace, actor } as TenantContext;
}
