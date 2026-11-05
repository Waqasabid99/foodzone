import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { periodReportSchema } from "@/server/validation/finance.schemas";
import { auditLedger } from "@/server/services/journal.service";

/**
 * Re-checks that the ledger adds up.
 *
 * Postgres cannot enforce "debits equal credits" — it is a constraint across
 * rows — so the claim is made by the posting service and proved here. A failure
 * means something wrote to `JournalLine` without going through `postJournal`,
 * and the entries it names are where to look.
 */
export const GET = apiHandler(
  { auth: true, permissions: "financial_reports.view_trial_balance", query: periodReportSchema },
  async ({ query, auth }) => ok(await auditLedger({ ...query, scope: branchScope(auth, "financial_reports.view_trial_balance") })),
);
