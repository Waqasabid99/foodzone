import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/inventory/access";
import { listCountsSchema, startCountSchema } from "@/server/validation/inventory.schemas";
import { listCounts, startCount } from "@/server/services/stock-count.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_counts.read", query: listCountsSchema, branch: "query" },
  async ({ query, auth }) => ok(await listCounts({ ...query, scope: branchScope(auth, "stock_counts.read") })),
);

/**
 * Opens a count sheet.
 *
 * The system quantity is frozen **now**, not at posting time: a count that
 * compares against a live figure is comparing against a number that moved while
 * the counting was happening, and the variance it produces means nothing.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_counts.create",
    body: startCountSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => {
    await assertRecordAccess(auth, "location", body.locationId, "stock_counts.create");
    return created(await startCount({ ...body, actor: auth }));
  },
);
