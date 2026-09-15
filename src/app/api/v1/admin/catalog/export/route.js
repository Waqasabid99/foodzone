import { apiHandler, RateLimits } from "@/lib/api";
import { catalogExportQuerySchema } from "@/server/validation/catalog.schemas";
import { exportResource } from "@/server/services/catalog-transfer.service";

/**
 * Downloads part of the catalog as CSV.
 *
 * Returns the file itself rather than the JSON envelope, because the caller is
 * a browser following a link or a person saving a spreadsheet. What comes out
 * is exactly what the importer reads back, so export → edit → import is a
 * round trip.
 *
 * Rate-limited as a read but on the stricter side: each call is a full table
 * scan of the catalog.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "catalog.export",
    query: catalogExportQuerySchema,
    rateLimit: { limit: 20, windowMs: 60_000 },
    scope: "catalog:export",
    audit: { action: "catalog.export", entityType: "Catalog" },
  },
  async ({ query }) => {
    const { csv, filename, rowCount, resource } = await exportResource(query.resource, {
      branchId: query.branchId ?? null,
      menuId: query.menuId ?? null,
    });

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        // The catalog changes when someone edits it, and a stale spreadsheet is
        // worse than a slow one.
        "cache-control": "no-store",
        "x-resource": resource,
        "x-row-count": String(rowCount),
      },
    });
  },
);
