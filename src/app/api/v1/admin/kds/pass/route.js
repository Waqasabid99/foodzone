import { apiHandler, ok, RateLimits } from "@/lib/api";
import { branchQuerySchema } from "@/server/validation/ordering.schemas";
import { readyToRun } from "@/server/services/kds.service";

/**
 * The pass: what is cooked and waiting to be carried out.
 *
 * The opposite question from the board. A cook asks what to make next; a
 * waiter asks what is standing under the heat lamp and whose table it belongs
 * to. Grouped per round rather than per order, so a starter on the pass and a
 * dessert that has just come up are the two trips they really are.
 *
 * A `read` rate limit, like the board: this screen polls continuously too.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "kds.read",
    query: branchQuerySchema,
    branch: "query",
    rateLimit: RateLimits.read,
    scope: "kds",
  },
  async ({ query }) => ok(await readyToRun({ branchId: query.branchId })),
);
