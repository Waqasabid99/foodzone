import { apiHandler, ok } from "@/lib/api";
import { periodReportSchema } from "@/server/validation/finance.schemas";
import { cashFlowReport } from "@/server/services/financial-report.service";

/**
 * Direct method: what actually moved through cash and bank, categorised by the
 * other side of each entry.
 *
 * More useful than an indirect statement for a restaurant, and more honest —
 * takings and supplier payments are movements somebody can check against a bank
 * statement, rather than a figure derived from every accrual being right.
 */
export const GET = apiHandler(
  { auth: true, permissions: "financial_reports.view_cash_flow", query: periodReportSchema, branch: "query" },
  async ({ query }) => ok(await cashFlowReport(query)),
);
