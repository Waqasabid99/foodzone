import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { createTableSchema, tableQuerySchema } from "@/server/validation/dinein.schemas";
import { createTable, listTables } from "@/server/services/table.service";
import { branchScope } from "@/lib/api/permissions";

export const GET = apiHandler(
  { auth: true, permissions: "tables.read", query: tableQuerySchema, branch: "query" },
  async ({ query, auth }) => {
    const { items, nextCursor, limit } = await listTables({ ...query, scope: branchScope(auth, "tables.read") });
    return paginated(items, { nextCursor, limit });
  },
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "tables.create",
    body: createTableSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "table.create", entityType: "RestaurantTable", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body }) => created(await createTable(body)),
);
