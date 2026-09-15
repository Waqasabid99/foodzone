import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reverseEarningSchema } from "@/server/validation/creator.schemas";
import { revokeOrderAttribution } from "@/server/services/creator-attribution.service";

/** Refused once the earning has credited — reverse the earning instead. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "creator_earnings.reverse",
    params: idParamSchema,
    body: reverseEarningSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await revokeOrderAttribution(params.id, { reason: body.reason, actor: auth })),
);
