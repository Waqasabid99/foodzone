import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { createRuleSchema, listRulesSchema } from "@/server/validation/creator.schemas";
import { createRule, listRules } from "@/server/services/creator-commission.service";

/**
 * Scoped to the branches the caller may read rules at. A rule carries a list
 * of branches and an empty list means the whole chain, so the cut is the same
 * one promotions get — see `server/access/scope.js`.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_commission_rules.read", query: listRulesSchema, branch: "query" },
  async ({ auth, query }) =>
    ok(await listRules({ ...query, scope: branchScope(auth, "creator_commission_rules.read") })),
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
