import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { periodReportSchema } from "@/server/validation/finance.schemas";
import { financialSummary } from "@/server/services/financial-report.service";

/**
 * The period-close pack.
 *
 * Carries its own `checks`: whether the trial balance agrees and whether the
 * balance sheet balances. A pack whose statements do not tie is one nobody
 * should sign off, and that is much better said on the page than discovered
 * afterwards.
 */
export const GET = apiHandler(
  { auth: true, permissions: "financial_reports.view_pnl", query: periodReportSchema, branch: "query" },
  async ({ query, auth }) => ok(await financialSummary({ ...query, scope: branchScope(auth, "financial_reports.view_pnl") })),
);
