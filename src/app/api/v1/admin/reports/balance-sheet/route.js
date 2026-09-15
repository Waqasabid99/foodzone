import { apiHandler, ok } from "@/lib/api";
import { asOfReportSchema } from "@/server/validation/finance.schemas";
import { balanceSheetReport } from "@/server/services/financial-report.service";

/**
 * A statement of position as at a date, so it takes `asOf` and never a range.
 *
 * `currentEarnings` is the profit for the year so far, carried into equity.
 * Without it the statement is out by exactly that amount — the commonest way a
 * home-grown ledger produces a visibly wrong report.
 */
export const GET = apiHandler(
  { auth: true, permissions: "financial_reports.view_balance_sheet", query: asOfReportSchema, branch: "query" },
  async ({ query }) => ok(await balanceSheetReport(query)),
);
