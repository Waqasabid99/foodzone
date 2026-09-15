import { apiHandler, ok } from "@/lib/api";
import { periodReportSchema } from "@/server/validation/finance.schemas";
import { trialBalanceReport } from "@/server/services/financial-report.service";

/**
 * The first thing anybody looks at when the books are suspect.
 *
 * The totals agree by construction if every entry balanced, so a disagreement
 * means something wrote to the ledger without going through the posting service.
 */
export const GET = apiHandler(
  { auth: true, permissions: "financial_reports.view_trial_balance", query: periodReportSchema, branch: "query" },
  async ({ query }) => ok(await trialBalanceReport(query)),
);
