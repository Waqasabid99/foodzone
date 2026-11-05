import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { periodReportSchema } from "@/server/validation/finance.schemas";
import { profitAndLossReport } from "@/server/services/financial-report.service";

/**
 * A period statement — `from` matters, because running one without it silently
 * reports since the beginning of time.
 *
 * Discounts are contra-income rather than an expense, so gross and net revenue
 * are both readable and margins come out right.
 */
export const GET = apiHandler(
  { auth: true, permissions: "financial_reports.view_pnl", query: periodReportSchema, branch: "query" },
  async ({ query, auth }) => ok(await profitAndLossReport({ ...query, scope: branchScope(auth, "financial_reports.view_pnl") })),
);
