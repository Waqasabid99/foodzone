import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { bumpSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { bumpOrder } from "@/server/services/kds.service";

/** Bumps a whole ticket at once — the button a chef actually presses. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "kds.update_item_status",
    params: idParamSchema,
    body: bumpSchema,
    rateLimit: RateLimits.write,
    scope: "kds",
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "kds.update_item_status");
    return ok(
      await bumpOrder({
        orderId: params.id,
        status: body.status,
        stationId: body.stationId ?? null,
        course: body.course ?? null,
        actorId: auth.userId,
      }),
    );
  },
);
