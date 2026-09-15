import { apiHandler, ok } from "@/lib/api";
import { simulateSchema } from "@/server/validation/creator.schemas";
import { simulate } from "@/server/services/creator-commission.service";

/**
 * What would this sale pay, and which rule wins.
 *
 * Every candidate comes back with whether it qualified and why not — "why did
 * the rule I just wrote not apply" is the question this exists to answer, and
 * the alternative is discovering the interaction between four overlapping
 * campaigns by underpaying somebody.
 */
export const POST = apiHandler(
  { auth: true, permissions: "creator_commission_rules.read", body: simulateSchema },
  async ({ body }) => ok(await simulate(body)),
);
