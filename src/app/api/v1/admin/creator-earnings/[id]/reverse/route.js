import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reverseEarningSchema } from "@/server/validation/creator.schemas";
import { reverseEarning } from "@/server/services/creator-earning.service";
import { assertEarningAccess } from "@/server/creator/access";

/**
 * Claws an earning back.
 *
 * A credited earning is debited out of the wallet, possibly into the negative —
 * deliberately: the credit was spent on food that was then refunded, and
 * pretending otherwise leaves the program short.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_earnings.reverse",
    params: idParamSchema,
    body: reverseEarningSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    // Taking money back is a write against one branch's order, so the same
    // cut applies as to reading it: an id from outside the caller's branches
    // is a 404, not a 403.
    await assertEarningAccess(auth, params.id, "creator_earnings.reverse");
    return ok(await reverseEarning(params.id, { reason: body.reason, actor: auth }));
  },
);
