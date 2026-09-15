import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setCreatorStatusSchema } from "@/server/validation/creator.schemas";
import { setCreatorStatus } from "@/server/services/creator.service";

/** Suspending needs `creators.suspend`; a ban is checked in the service path. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "creators.suspend",
    params: idParamSchema,
    body: setCreatorStatusSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await setCreatorStatus(params.id, { ...body, actor: auth })),
);
