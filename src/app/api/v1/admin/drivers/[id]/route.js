import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateDriverSchema } from "@/server/validation/delivery.schemas";
import { getDriver, updateDriver } from "@/server/services/driver.service";

export const GET = apiHandler(
  { auth: true, permissions: "drivers.read", params: idParamSchema },
  async ({ params }) => ok(await getDriver(params.id)),
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
  async ({ params, body }) => ok(await updateDriver(params.id, body)),
);
