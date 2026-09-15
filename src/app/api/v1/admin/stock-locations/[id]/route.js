import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateLocationSchema } from "@/server/validation/inventory.schemas";
import { getLocation, updateLocation } from "@/server/services/inventory-item.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_locations.read", params: idParamSchema },
  async ({ params }) => ok(await getLocation(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "stock_locations.manage",
    params: idParamSchema,
    body: updateLocationSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body }) => ok(await updateLocation(params.id, body)),
);
