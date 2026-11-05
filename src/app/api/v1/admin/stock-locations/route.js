import { z } from "zod";
import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { createLocationSchema } from "@/server/validation/inventory.schemas";
import { createLocation, listLocations } from "@/server/services/inventory-item.service";

const querySchema = z.object({ branchId: cuidSchema.optional(), isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "stock_locations.read", query: querySchema, branch: "query" },
  async ({ query, auth }) => ok(await listLocations({ ...query, scope: branchScope(auth, "stock_locations.read") })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_locations.manage",
    body: createLocationSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body }) => created(await createLocation(body)),
);
