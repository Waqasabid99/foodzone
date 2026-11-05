import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";

/** Live carts: a read-only support view over baskets in progress. */
export const listCartsSchema = z.object({
  branchId: cuidSchema.optional(),
  type: z.enum(["DELIVERY", "PICKUP", "DINE_IN"]).optional(),
  identity: z.enum(["SIGNED_IN", "GUEST"]).optional(),
  search: z.string().trim().min(1).max(60).optional(),
  /** Off by default: a cart row exists the moment anybody opens the menu. */
  includeEmpty: z.stringbool().optional(),
  /** Only carts untouched for this many minutes — the abandoned ones. */
  staleMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
