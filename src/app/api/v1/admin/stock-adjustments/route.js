import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { createAdjustmentSchema } from "@/server/validation/inventory.schemas";
import { createAdjustment, listAdjustments } from "@/server/services/stock-adjustment.service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]).optional(),
});

export const GET = apiHandler(
  { auth: true, permissions: "stock_adjustments.read", query: querySchema, branch: "query" },
  async ({ query }) => ok(await listAdjustments(query)),
);

/**
 * Raises an adjustment. Nothing moves until it is approved.
 *
 * Reason-coded and approval-gated because an adjustment with no justification
 * is indistinguishable from theft being written off.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_adjustments.create",
    body: createAdjustmentSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createAdjustment({ ...body, actor: auth })),
);
