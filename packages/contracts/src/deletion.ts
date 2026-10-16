import { z } from "zod";

/** What a Workspace or Bot deletion will take with it, shown before the owner confirms. */
export const DeletionPreview = z.strictObject({
  conversations: z.int().nonnegative(),
});
export type DeletionPreview = z.infer<typeof DeletionPreview>;
