import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reverseEarningSchema } from "@/server/validation/creator.schemas";
import { rejectEarning } from "@/server/services/creator-earning.service";

/** Voids an earning before it credits — the fraud path. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_earnings.reverse",
    params: idParamSchema,
    body: reverseEarningSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await rejectEarning(params.id, { reason: body.reason, actor: auth })),
);
