import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createStationSchema } from "@/server/validation/catalog.schemas";
import { createStation, listStations } from "@/server/services/station.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "kitchen_stations.read", query: querySchema },
  async ({ query }) => ok(await listStations(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "kitchen_stations.manage",
    body: createStationSchema,
    rateLimit: RateLimits.write,
    audit: { action: "kitchen_station.create", entityType: "KitchenStation", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body }) => created(await createStation(body)),
);
