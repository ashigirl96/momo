import {
  CreateBotRequest,
  ProposeBotRequest,
  RunnerOutbound,
  UpdateBotRequest,
  type BotItem,
  type BotList,
  type BotSettingsProposal,
  type UpdateBotResponse,
} from "@momo/contracts";
import { updateBotSettings } from "@momo/agent";
import { createBot, getBot, listBots, type Bot } from "@momo/workspace";
import { proposeBotSettings } from "../fake-runner.ts";
import { apiError, json } from "./respond.ts";
import { decode, listQuery, paged, type RouteContext } from "./route.ts";
import type { WorkspaceScopedRequest } from "./workspaces.ts";

const BOT = /^\/bots\/([^/]+)$/;

function toBotItem(bot: Bot): BotItem {
  return {
    id: bot.id,
    name: bot.name,
    instructions: bot.instructions,
    instructionsVersion: bot.instructionsVersion,
    model: bot.model,
    tools: bot.tools,
    createdAt: bot.createdAt.getTime(),
  };
}

/** Takes the proposal out of the runner's messages, trusting none that fail the wire schema. */
function proposalFrom(messages: unknown[]): BotSettingsProposal | undefined {
  for (const message of messages) {
    const parsed = RunnerOutbound.safeParse(message);
    if (!parsed.success || parsed.data.kind !== "tool_request" || parsed.data.runId !== undefined) continue;
    if (parsed.data.tool.kind === "propose_bot_settings") return parsed.data.tool.proposal;
  }
  return undefined;
}

export async function botRoute(
  { req, rest, workspaceScope, body }: WorkspaceScopedRequest,
  ctx: RouteContext,
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
      return paged(() => {
        const page = listBots(ctx.db, workspaceScope, listQuery(req));
        return json({ bots: page.items.map(toBotItem), nextCursor: page.nextCursor } satisfies BotList);
      });
    }
    if (req.method === "POST") {
      const input = CreateBotRequest.safeParse(await body());
      if (!input.success) return apiError("bad_request", "expected { name, instructions, model, tools }");
      return json(toBotItem(createBot(ctx.db, workspaceScope, { ...input.data, now: ctx.now() })), {
        status: 201,
      });
    }
    return undefined;
  }

  const match = BOT.exec(rest);
  if (!match) return undefined;
  const id = decode(match[1]!);
  if (id === undefined) return apiError("not_found", "no such Bot");
  if (req.method === "GET") {
    const bot = getBot(ctx.db, workspaceScope, id);
    return bot ? json(toBotItem(bot)) : apiError("not_found", "no such Bot");
  }
  if (req.method === "PATCH") {
    const input = UpdateBotRequest.safeParse(await body());
    if (!input.success)
      return apiError("bad_request", "expected some of { name, instructions, model, tools }");
    const updated = updateBotSettings(ctx.db, workspaceScope, id, { ...input.data, now: ctx.now() });
    if (!updated) return apiError("not_found", "no such Bot");
    ctx.runs.stopCancelled(updated.cancelledRunning);
    for (const session of updated.closed) ctx.hub.notify(workspaceScope.workspaceId, session.conversationId);
    return json({
      bot: toBotItem(updated.bot),
      sessionsRenewed: updated.instructionsChanged,
      closedSessions: updated.closed.length,
    } satisfies UpdateBotResponse);
  }
  return undefined;
}
