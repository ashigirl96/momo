import { z } from "zod";

export const DeletionPreview = z.strictObject({
  conversations: z.int().nonnegative(),
});
export type DeletionPreview = z.infer<typeof DeletionPreview>;
