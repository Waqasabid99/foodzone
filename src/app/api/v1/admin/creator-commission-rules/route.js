import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createRuleSchema, listRulesSchema } from "@/server/validation/creator.schemas";
import { createRule, listRules } from "@/server/services/creator-commission.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_commission_rules.read", query: listRulesSchema },
  async ({ query }) => ok(await listRules(query)),
);

/**
 * Exactly one rule applies per attributed line — they are never stacked.
 * Highest priority wins, then specificity, then most recent.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_commission_rules.create",
    body: createRuleSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createRule(body, auth)),
);
