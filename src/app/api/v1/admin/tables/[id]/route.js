import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateTableSchema } from "@/server/validation/dinein.schemas";
import { assertTableAccess, deleteTable, getTable, updateTable } from "@/server/services/table.service";

export const GET = apiHandler(
  { auth: true, permissions: "tables.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertTableAccess(auth, params.id, "tables.read");
    return ok(await getTable(params.id));
  },
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "tables.update",
    params: idParamSchema,
    body: updateTableSchema,
    rateLimit: RateLimits.write,
    audit: { action: "table.update", entityType: "RestaurantTable" },
  },
  async ({ auth, params, body }) => {
    await assertTableAccess(auth, params.id, "tables.update");
    return ok(await updateTable(params.id, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "tables.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "table.delete", entityType: "RestaurantTable" },
  },
  async ({ auth, params }) => {
    await assertTableAccess(auth, params.id, "tables.delete");
    return ok(await deleteTable(params.id));
  },
);
