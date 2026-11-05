import { apiHandler, branchScope, ok } from "@/lib/api";
import { statsQuerySchema } from "@/server/validation/creator.schemas";
import { earningsSummary } from "@/server/services/creator-earning.service";

/**
 * What the program costs against the revenue it drove.
 *
 * `costOfSalesPercent` is the number that decides whether the program
 * continues, so it is computed here rather than left to a spreadsheet.
 *
 * Scoped for the same reason the rows are: a total is a leak too. Handing a
 * branch-scoped reader the company-wide figure tells them the whole
 * programme's payout even though every row behind it is hidden from them.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_earnings.read", query: statsQuerySchema, branch: "query" },
  async ({ auth, query }) => ok(await earningsSummary({ ...query, scope: branchScope(auth, "creator_earnings.read") })),
);
