import { apiHandler, ok } from "@/lib/api";
import { driverQueue } from "@/server/services/delivery.service";
import { requireDriver } from "@/server/services/driver.service";

/**
 * The driver's own queue, worked in planned `sequence` order.
 *
 * Each job carries the address and a contact number and nothing else about the
 * customer — a driver needs to find the door, not to see what was paid.
 */
export const GET = apiHandler({ auth: true, scope: "me:driver" }, async ({ auth }) => {
  const driver = await requireDriver(auth.userId);
  return ok(await driverQueue({ driverId: driver.id }));
});
