import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateRuleSchema } from "@/server/validation/creator.schemas";
import { deleteRule, getRule, updateRule } from "@/server/services/creator-commission.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_commission_rules.read", params: idParamSchema },
  async ({ params }) => ok(await getRule(params.id)),
);

/** Safe to edit after it has paid: earnings snapshot what they were paid under. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "creator_commission_rules.update",
    params: idParamSchema,
    body: updateRuleSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateRule(params.id, body, auth)),
);

/** Refused once it has paid — it is the explanation for money already given out. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "creator_commission_rules.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => {
    await deleteRule(params.id, auth);
    return noContent();
  },
);
