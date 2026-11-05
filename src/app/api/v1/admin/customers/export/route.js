import { apiHandler, branchScope } from "@/lib/api";
import { customerExportQuerySchema } from "@/server/validation/customer.schemas";
import { EXPORT_COLUMNS, exportCustomers } from "@/server/services/customer.service";
import { toCsv } from "@/server/catalog/csv";

/**
 * The customer list as a spreadsheet, exactly as filtered on screen.
 *
 * Its own permission (`customers.export`): reading one customer's details to
 * answer a question and walking out with the whole list are different acts, and
 * the export is the one worth auditing.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "customers.export",
    query: customerExportQuerySchema,
    rateLimit: { limit: 10, windowMs: 60_000 },
    scope: "customers:export",
    audit: { action: "customer.export", entityType: "User", entityId: () => null },
  },
  async ({ auth, query }) => {
    const rows = await exportCustomers({ ...query, scope: branchScope(auth, "customers.read") });

    return new Response(toCsv(EXPORT_COLUMNS, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
        "x-row-count": String(rows.length),
      },
    });
  },
);
