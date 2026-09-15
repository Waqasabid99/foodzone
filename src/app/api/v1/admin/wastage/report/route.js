import { apiHandler, ok } from "@/lib/api";
import { reportRangeSchema } from "@/server/validation/inventory.schemas";
import { wastageReport } from "@/server/services/stock-adjustment.service";

/**
 * What is being thrown away, and why.
 *
 * Grouped by reason because that is the actionable cut: "expired" points at
 * over-ordering, "cooking error" at training, "spoiled" at a fridge.
 */
export const GET = apiHandler(
  { auth: true, permissions: "wastage.read", query: reportRangeSchema, branch: "query" },
  async ({ query }) => ok(await wastageReport(query)),
);
