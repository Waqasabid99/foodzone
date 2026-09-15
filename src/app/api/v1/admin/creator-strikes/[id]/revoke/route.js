import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { revokeStrikeSchema } from "@/server/validation/creator.schemas";
import { revokeStrike } from "@/server/services/creator.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "creators.adjust_strikes",
    params: idParamSchema,
    body: revokeStrikeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await revokeStrike({ strikeId: params.id, reason: body.reason, actor: auth })),
);
