import { ApiError, apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setDeliveryStatusSchema } from "@/server/validation/delivery.schemas";
import { getDelivery, setDeliveryStatus } from "@/server/services/delivery.service";
import { requireDriver } from "@/server/services/driver.service";

/**
 * A driver moving their own job along.
 *
 * `byDriver` narrows the machine: forward through the run, plus reject and
 * fail. A driver cannot cancel an order, hand a job back once the food is in
 * their bag, or touch a delivery that is not theirs — that last case is a 404
 * rather than a 403, so the endpoint cannot be used to discover which delivery
 * ids exist.
 */
export const PUT = apiHandler(
  {
    auth: true,
    params: idParamSchema,
    body: setDeliveryStatusSchema,
    rateLimit: RateLimits.write,
    scope: "me:driver",
  },
  async ({ auth, params, body }) => {
    const driver = await requireDriver(auth.userId);
    const delivery = await getDelivery(params.id);

    if (delivery.driverId !== driver.id) throw ApiError.notFound("Delivery not found");

    return ok(await setDeliveryStatus({ deliveryId: params.id, ...body, actor: auth, byDriver: true }));
  },
);
