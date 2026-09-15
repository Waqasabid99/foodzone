import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateStationSchema } from "@/server/validation/catalog.schemas";
import { deleteStation, updateStation } from "@/server/services/station.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    params: idParamSchema,
    body: updateStationSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.update", entityType: "KitchenStation" },
  },
  async ({ params, body }) => ok(await updateStation(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.delete", entityType: "KitchenStation" },
  },
  async ({ params }) => ok(await deleteStation(params.id)),
);
