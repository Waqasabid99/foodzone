import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertPermission } from "@/lib/api/permissions";
import { idParamSchema } from "@/server/validation/schemas";
import { assignDriverSchema } from "@/server/validation/delivery.schemas";
import { assignDriver } from "@/server/services/delivery.service";

/**
 * Assigns or reassigns a driver.
 *
 * Reassignment is a separate permission because it takes work away from someone
 * who may already be on their way, and refuses outright once the food is in
 * their bag — that case is a failure to record, not a reassignment.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: ["deliveries.assign", "deliveries.reassign"],
    anyPermission: true,
    params: idParamSchema,
    body: assignDriverSchema,
    rateLimit: RateLimits.write,
    audit: { action: "delivery.assign", entityType: "Delivery" },
  },
  async ({ params, body, auth }) => {
    if (body.reassign) {
      // Checked explicitly: `anyPermission` above lets an assigner through, and
      // reassigning is the stricter of the two actions.
      assertPermission(auth, "deliveries.reassign");
    }

    return ok(
      await assignDriver({
        deliveryId: params.id,
        driverId: body.driverId,
        reassign: body.reassign,
        actor: auth,
      }),
    );
  },
);
