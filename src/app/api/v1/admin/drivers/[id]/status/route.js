import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setDriverStatusSchema } from "@/server/validation/delivery.schemas";
import { setDriverStatus } from "@/server/services/driver.service";
import { assertRecordAccess } from "@/server/delivery/access";

export const PUT = apiHandler(
  {
    auth: true,
    permissions: "drivers.update",
    params: idParamSchema,
    body: setDriverStatusSchema,
    rateLimit: RateLimits.write,
    audit: { action: "driver.set_status", entityType: "Driver" },
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "driver", params.id, "drivers.update");
    return ok(await setDriverStatus({ driverId: params.id, status: body.status }));
  },
);
