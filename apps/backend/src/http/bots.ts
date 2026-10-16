import {
  CreateBotRequest,
  ProposeBotRequest,
  RunnerOutbound,
  UpdateBotRequest,
  type BotItem,
  type BotList,
  type BotSettingsProposal,
} from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { createBot, getBot, InvalidCursor, listBots, updateBot, type Bot } from "@momo/workspace";
import { proposeBotSettings } from "../fake-runner.ts";
import { apiError, json } from "./respond.ts";
import type { TenantRequest } from "./workspaces.ts";

type BotApiContext = { db: Db; now: () => Date };

const BOT = /^\/bots\/([^/]+)$/;

function toItem(bot: Bot): BotItem {
  return {
    id: bot.id,
    name: bot.name,
    instructions: bot.instructions,
    model: bot.model,
    tools: bot.tools,
    createdAt: bot.createdAt.getTime(),
  };
}

/** Takes the proposal out of the runner's messages, trusting none that fail the wire schema. */
function proposalFrom(messages: unknown[]): BotSettingsProposal | undefined {
  for (const message of messages) {
    const parsed = RunnerOutbound.safeParse(message);
    if (parsed.success && parsed.data.tool.kind === "propose_bot_settings") return parsed.data.tool.proposal;
  }
  return undefined;
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function listQuery(req: Request): { cursor?: string; limit?: number } {
  const query = new URL(req.url).searchParams;
  const cursor = query.get("cursor") ?? undefined;
  const limit = query.has("limit") ? Number(query.get("limit")) : undefined;
  return { cursor, limit };
}

/** Routes `/api/workspaces/:workspaceId/bots…`; undefined means the path is not one of ours. */
export async function botRoute(
  { req, rest, tenant, body }: TenantRequest,
  ctx: BotApiContext,
): Promise<Response | undefined> {
  if (rest === "/bot-proposals" && req.method === "POST") {
    const input = ProposeBotRequest.safeParse(await body());
    if (!input.success) return apiError("bad_request", "expected { purpose } of 1–500 characters");
    const proposal = proposalFrom(proposeBotSettings(input.data.purpose));
    if (!proposal) return apiError("bad_request", "the Bot made no valid proposal");
    return json(proposal satisfies BotSettingsProposal);
  }

  if (rest === "/bots") {
    if (req.method === "GET") {
      try {
        const page = listBots(ctx.db, tenant, listQuery(req));
        return json({ bots: page.items.map(toItem), nextCursor: page.nextCursor } satisfies BotList);
      } catch (error) {
        if (error instanceof InvalidCursor) return apiError("bad_request", "invalid cursor");
        throw error;
      }
    }
    if (req.method === "POST") {
      const input = CreateBotRequest.safeParse(await body());
      if (!input.success) return apiError("bad_request", "expected { name, instructions, model, tools }");
      return json(toItem(createBot(ctx.db, tenant, { ...input.data, now: ctx.now() })), { status: 201 });
    }
    return undefined;
  }

  const match = BOT.exec(rest);
  if (!match) return undefined;
  const id = decode(match[1]!);
  if (id === undefined) return apiError("not_found", "no such Bot");
  if (req.method === "GET") {
    const bot = getBot(ctx.db, tenant, id);
    return bot ? json(toItem(bot)) : apiError("not_found", "no such Bot");
  }
  if (req.method === "PATCH") {
    const input = UpdateBotRequest.safeParse(await body());
    if (!input.success) return apiError("bad_request", "expected some of { name, model, tools }");
    const bot = updateBot(ctx.db, tenant, id, input.data);
    return bot ? json(toItem(bot)) : apiError("not_found", "no such Bot");
  }
  return undefined;
}
