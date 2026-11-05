import { apiHandler, assertCompanyWide, ok, RateLimits } from "@/lib/api";
import { reorderSchema } from "@/server/validation/catalog.schemas";
import { reorderStations } from "@/server/services/station.service";

/** The order stations are listed in on the kitchen display's station picker. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    body: reorderSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.reorder", entityType: "KitchenStation", entityId: () => null },
  },
  async ({ auth, body }) => {
    assertCompanyWide(auth, "kitchen_stations.manage");
    return ok(await reorderStations(body));
  },
);
