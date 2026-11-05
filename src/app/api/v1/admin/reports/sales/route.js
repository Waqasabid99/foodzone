import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { salesReportSchema } from "@/server/validation/finance.schemas";
import { salesReport } from "@/server/services/operational-report.service";

/** Completed orders only — a cancelled order is not a sale. */
export const GET = apiHandler(
  { auth: true, permissions: "reports.view_sales", query: salesReportSchema, branch: "query" },
  async ({ query, auth }) => ok(await salesReport({ ...query, scope: branchScope(auth, "reports.view_sales") })),
);
