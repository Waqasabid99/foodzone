import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { usageVariance } from "@/server/services/depletion.service";

const querySchema = z.object({
  branchId: cuidSchema,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Theoretical versus actual usage.
 *
 * What the recipes say should have been used against what the ledger says left
 * the shelf. A persistent gap is portioning drift, waste that is not being
 * recorded, or theft — and it is invisible without this comparison.
 */
export const GET = apiHandler(
  { auth: true, permissions: "stock.view_valuation", query: querySchema, branch: "query" },
  async ({ query }) => ok(await usageVariance(query)),
);
