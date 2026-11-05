import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateDriverSchema } from "@/server/validation/delivery.schemas";
import { getDriver, updateDriver } from "@/server/services/driver.service";
import { assertRecordAccess } from "@/server/delivery/access";

export const GET = apiHandler(
  { auth: true, permissions: "drivers.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "driver", params.id, "drivers.read");
    return ok(await getDriver(params.id));
  },
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "drivers.update",
    params: idParamSchema,
    body: updateDriverSchema,
    rateLimit: RateLimits.write,
    audit: { action: "driver.update", entityType: "Driver" },
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "driver", params.id, "drivers.update");
    return ok(await updateDriver(params.id, body));
  },
);
