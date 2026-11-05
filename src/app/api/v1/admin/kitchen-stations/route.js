import { z } from "zod";
import { apiHandler, assertCompanyWide, created, ok, RateLimits } from "@/lib/api";
import { createStationSchema } from "@/server/validation/catalog.schemas";
import { createStation, listStations } from "@/server/services/station.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "kitchen_stations.read", query: querySchema },
  async ({ query }) => ok(await listStations(query)),
);

/**
 * Stations are company-wide — every product routes to one, and products are
 * shared by every branch — so managing them takes a company-wide grant. A
 * branch manager holds `kitchen_stations.manage` for their own outlet only,
 * which is not enough to rename a station every other kitchen prints to.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    body: createStationSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.create", entityType: "KitchenStation", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ auth, body }) => {
    assertCompanyWide(auth, "kitchen_stations.manage");
    return created(await createStation(body));
  },
);
