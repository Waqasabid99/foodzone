import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { expiryReport } from "@/server/services/stock.service";

const querySchema = z.object({
  branchId: cuidSchema.optional(),
  withinDays: z.coerce.number().int().min(0).max(365).default(7),
});

/** What to use, discount or throw away — the daily kitchen list. */
export const GET = apiHandler(
  { auth: true, permissions: "stock_batches.read", query: querySchema, branch: "query" },
  async ({ query }) => ok(await expiryReport(query)),
);
