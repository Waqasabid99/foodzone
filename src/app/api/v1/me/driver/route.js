import { apiHandler, ok } from "@/lib/api";
import { requireDriver } from "@/server/services/driver.service";
import { driverEarningsSummary } from "@/server/services/driver-payout.service";

/**
 * The driver's own profile.
 *
 * Gated by *being a driver* rather than by a permission: driver endpoints are
 * ownership-scoped in the same way `/me/orders` is, so a driver needs no role
 * grant to see their own work.
 */
export const GET = apiHandler({ auth: true, scope: "me:driver" }, async ({ auth }) => {
  const driver = await requireDriver(auth.userId);
  const earnings = await driverEarningsSummary({ driverId: driver.id });

  return ok({ driver, earnings });
});
