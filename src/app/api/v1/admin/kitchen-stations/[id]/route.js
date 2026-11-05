import { apiHandler, assertCompanyWide, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateStationSchema } from "@/server/validation/catalog.schemas";
import { deleteStation, updateStation } from "@/server/services/station.service";

/** Company-wide only; see the collection route. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    params: idParamSchema,
    body: updateStationSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.update", entityType: "KitchenStation" },
  },
  async ({ auth, params, body }) => {
    assertCompanyWide(auth, "kitchen_stations.manage");
    return ok(await updateStation(params.id, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.delete", entityType: "KitchenStation" },
  },
  async ({ auth, params }) => {
    assertCompanyWide(auth, "kitchen_stations.manage");
    return ok(await deleteStation(params.id));
  },
);
