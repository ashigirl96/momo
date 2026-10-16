import { z } from "zod";

const epochMs = z.int().nonnegative();

export const BOT_NAME_MAX = 50;
export const BOT_INSTRUCTIONS_MAX = 4000;
export const BOT_PURPOSE_MAX = 500;

/** The model a Bot asks for. Stored and shown only; the fake runner does not read it. */
export const BotModel = z.enum(["sonnet", "opus", "haiku"]);
export type BotModel = z.infer<typeof BotModel>;

/** The momo tools a Bot may use. Stored and shown only; the fake runner does not read it. */
export const BotTool = z.enum(["memory"]);
export type BotTool = z.infer<typeof BotTool>;

export const DEFAULT_BOT_MODEL: BotModel = "sonnet";
export const DEFAULT_BOT_TOOLS: BotTool[] = ["memory"];

const BotName = z.string().trim().min(1).max(BOT_NAME_MAX);
const BotInstructions = z.string().trim().min(1).max(BOT_INSTRUCTIONS_MAX);
const BotTools = z.array(BotTool).refine((tools) => new Set(tools).size === tools.length, "duplicate tool");

export const BotItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  instructions: z.string(),
  model: BotModel,
  tools: z.array(BotTool),
  createdAt: epochMs,
});
export type BotItem = z.infer<typeof BotItem>;

export const BotList = z.strictObject({
  bots: z.array(BotItem),
  nextCursor: z.string().optional(),
});
export type BotList = z.infer<typeof BotList>;

/** The Workspace comes from the path and the id from the backend; a request naming either is refused. */
export const CreateBotRequest = z.strictObject({
  name: BotName,
  instructions: BotInstructions,
  model: BotModel,
  tools: BotTools,
});
export type CreateBotRequest = z.input<typeof CreateBotRequest>;

/** Changing the instructions renews the Session, so it is not part of this request. */
export const UpdateBotRequest = z
  .strictObject({ name: BotName.optional(), model: BotModel.optional(), tools: BotTools.optional() })
  .refine((patch) => Object.keys(patch).length > 0, "nothing to update");
export type UpdateBotRequest = z.input<typeof UpdateBotRequest>;

/** What the owner tells a new Bot it is for. */
export const ProposeBotRequest = z.strictObject({
  purpose: z.string().trim().min(1).max(BOT_PURPOSE_MAX),
});
export type ProposeBotRequest = z.input<typeof ProposeBotRequest>;

/**
 * The name and instructions a Bot proposes for itself. The "Bot の設定" card draws these fields
 * next to momo's own labels; no other Bot text goes into the card.
 */
export const BotSettingsProposal = z.strictObject({
  name: BotName,
  instructions: BotInstructions,
});
export type BotSettingsProposal = z.infer<typeof BotSettingsProposal>;
