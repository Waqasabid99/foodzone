import { z } from "zod";
import { apiHandler, assertCompanyWide, created, ok, RateLimits } from "@/lib/api";
import { createUnitSchema, uomTypeSchema } from "@/server/validation/inventory.schemas";
import { createUnit, listUnits } from "@/server/services/uom.service";

const querySchema = z.object({ type: uomTypeSchema.optional(), isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "units.read", query: querySchema },
  async ({ query }) => ok(await listUnits(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "units.manage",
    body: createUnitSchema,
    rateLimit: RateLimits.write,
    audit: { action: "uom.create", entityType: "UnitOfMeasure", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => {
    // Every branch measures in the same units; a conversion is not one
    // outlet's to decide.
    assertCompanyWide(auth, "units.manage");
    return created(await createUnit(body));
  },
);
