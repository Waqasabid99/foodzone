import { apiHandler, ok, RateLimits } from "@/lib/api";
import { driverAvailabilitySchema } from "@/server/validation/delivery.schemas";
import { requireDriver, setDriverStatus } from "@/server/services/driver.service";

/**
 * Going on or off shift.
 *
 * The schema offers only AVAILABLE, ON_BREAK and OFFLINE. ON_DELIVERY is a
 * consequence of holding work rather than a choice, and SUSPENDED is a
 * management action — a driver lifting their own suspension would make it
 * meaningless.
 */
export const PUT = apiHandler(
  { auth: true, body: driverAvailabilitySchema, rateLimit: RateLimits.write, scope: "me:driver" },
  async ({ auth, body }) => {
    const driver = await requireDriver(auth.userId);
    return ok(await setDriverStatus({ driverId: driver.id, status: body.status, actorIsDriver: true }));
  },
);
