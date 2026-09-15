import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { endShiftSchema, startShiftSchema } from "@/server/validation/delivery.schemas";
import { endShift, requireDriver, startShift } from "@/server/services/driver.service";

export const POST = apiHandler(
  { auth: true, body: startShiftSchema, rateLimit: RateLimits.write, scope: "me:driver" },
  async ({ auth, body }) => {
    const driver = await requireDriver(auth.userId);
    return created(await startShift({ driverId: driver.id, branchId: body?.branchId ?? null }));
  },
);

/**
 * Ending a shift settles the cash the driver is carrying.
 *
 * Anything not handed in stays on their balance and is deducted from the next
 * payout, rather than being written off.
 */
export const DELETE = apiHandler(
  { auth: true, body: endShiftSchema, rateLimit: RateLimits.write, scope: "me:driver" },
  async ({ auth, body }) => {
    const driver = await requireDriver(auth.userId);
    return ok(await endShift({ driverId: driver.id, cashHandedOver: body.cashHandedOver }));
  },
);
