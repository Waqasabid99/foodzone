import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertPermission } from "@/lib/api/permissions";
import { idParamSchema } from "@/server/validation/schemas";
import { setDeliveryStatusSchema } from "@/server/validation/delivery.schemas";
import { setDeliveryStatus } from "@/server/services/delivery.service";

export const PUT = apiHandler(
  {
    auth: true,
    permissions: ["deliveries.update_status", "deliveries.mark_failed"],
    anyPermission: true,
    params: idParamSchema,
    body: setDeliveryStatusSchema,
    rateLimit: RateLimits.write,
    audit: { action: "delivery.set_status", entityType: "Delivery" },
  },
  async ({ params, body, auth }) => {
    if (body.status === "FAILED") {
      // `anyPermission` lets a status-updater through; failing a delivery is
      // the stricter action and is checked on its own.
      assertPermission(auth, "deliveries.mark_failed");
    }

    return ok(await setDeliveryStatus({ deliveryId: params.id, ...body, actor: auth }));
  },
);
