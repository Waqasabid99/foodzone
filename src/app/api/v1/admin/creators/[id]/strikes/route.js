import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { issueStrikeSchema } from "@/server/validation/creator.schemas";
import { issueStrike, listStrikes } from "@/server/services/creator.service";

export const GET = apiHandler(
  { auth: true, permissions: "creators.read", params: idParamSchema },
  async ({ params }) => ok(await listStrikes(params.id)),
);

/**
 * Points are recomputed from live strikes rather than incremented, so a revoked
 * strike genuinely undoes itself and the suspension it caused lifts.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creators.adjust_strikes",
    params: idParamSchema,
    body: issueStrikeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => created(await issueStrike({ creatorId: params.id, ...body, actor: auth })),
);
