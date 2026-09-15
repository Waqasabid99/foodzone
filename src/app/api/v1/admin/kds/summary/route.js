import { apiHandler, ok, RateLimits } from "@/lib/api";
import { branchQuerySchema } from "@/server/validation/ordering.schemas";
import { kitchenSummary } from "@/server/services/kds.service";

/** How the kitchen is doing right now — the number on the wall. */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "kds.read",
    query: branchQuerySchema,
    branch: "query",
    rateLimit: RateLimits.read,
    scope: "kds",
  },
  async ({ query }) => ok(await kitchenSummary(query)),
);
