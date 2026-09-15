import { apiHandler, ok } from "@/lib/api";
import { locationSchema } from "@/server/validation/delivery.schemas";
import { recordLocation, requireDriver } from "@/server/services/driver.service";

/**
 * A position ping from the driver app.
 *
 * Deliberately **not** rate-limited as a write: this is the one endpoint meant
 * to be called continuously. The last known point is overwritten on `Driver`,
 * while breadcrumbs are written to the active delivery only every ~30 seconds —
 * a row per ping would be millions a day per city, for data nobody reads
 * outside a dispute.
 */
export const POST = apiHandler(
  { auth: true, body: locationSchema, rateLimit: false, scope: "me:driver" },
  async ({ auth, body }) => {
    const driver = await requireDriver(auth.userId);

    return ok(
      await recordLocation({
        driverId: driver.id,
        ...body,
        at: body.recordedAt ?? new Date(),
      }),
    );
  },
);
