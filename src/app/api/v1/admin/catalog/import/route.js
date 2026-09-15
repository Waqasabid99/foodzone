import { apiHandler, ok } from "@/lib/api";
import { catalogImportSchema } from "@/server/validation/catalog.schemas";
import { importResource } from "@/server/services/catalog-transfer.service";

/**
 * Bulk-creates and updates catalog records from a CSV.
 *
 * Every row is validated before anything is written, and the writes happen in
 * one transaction: a half-imported catalog, with new prices on some products
 * and old prices on others, is worse than an import that failed outright.
 *
 * Send `dryRun: true` first. The response is identical apart from `applied`, so
 * the same screen can show what would happen and then what did.
 *
 * A separate permission from editing one product, because this rewrites prices
 * across the estate in a single call.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "catalog.import",
    body: catalogImportSchema,
    // A 5000-row file of products runs to a couple of megabytes.
    maxBodyBytes: 6 * 1024 * 1024,
    rateLimit: { limit: 10, windowMs: 60_000 },
    scope: "catalog:import",
    audit: { action: "catalog.import", entityType: "Catalog" },
  },
  async ({ body }) => ok(await importResource(body)),
);
