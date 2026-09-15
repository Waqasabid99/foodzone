import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateUnitSchema } from "@/server/validation/inventory.schemas";
import { deleteUnit, getUnit, updateUnit } from "@/server/services/uom.service";

export const GET = apiHandler(
  { auth: true, permissions: "units.read", params: idParamSchema },
  async ({ params }) => ok(await getUnit(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "units.manage",
    params: idParamSchema,
    body: updateUnitSchema,
    rateLimit: RateLimits.write,
    audit: { action: "uom.update", entityType: "UnitOfMeasure" },
  },
  async ({ params, body }) => ok(await updateUnit(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "units.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "uom.delete", entityType: "UnitOfMeasure" },
  },
  async ({ params }) => ok(await deleteUnit(params.id)),
);
