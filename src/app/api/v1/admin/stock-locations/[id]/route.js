import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateLocationSchema } from "@/server/validation/inventory.schemas";
import { assertRecordAccess } from "@/server/inventory/access";
import { getLocation, updateLocation } from "@/server/services/inventory-item.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_locations.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "location", params.id, "stock_locations.read");
    return ok(await getLocation(params.id));
  },
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "stock_locations.manage",
    params: idParamSchema,
    body: updateLocationSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "location", params.id, "stock_locations.manage");
    return ok(await updateLocation(params.id, body));
  },
);
