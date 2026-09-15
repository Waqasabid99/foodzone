import { apiHandler, created, RateLimits } from "@/lib/api";
import { bulkTableSchema } from "@/server/validation/dinein.schemas";
import { createTablesInBulk } from "@/server/services/table.service";

/**
 * Lays out a dining room in one call: `{ prefix: "T-", from: 1, to: 20 }`.
 * Existing names are skipped, so re-running after adding five more tables adds
 * exactly those five.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "tables.create",
    body: bulkTableSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "table.bulk_create", entityType: "RestaurantTable" },
  },
  async ({ body }) => created(await createTablesInBulk(body)),
);
