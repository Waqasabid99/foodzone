import { apiHandler, ok } from "@/lib/api";
import { statsQuerySchema } from "@/server/validation/creator.schemas";
import { earningsSummary } from "@/server/services/creator-earning.service";

/**
 * What the program costs against the revenue it drove.
 *
 * `costOfSalesPercent` is the number that decides whether the program
 * continues, so it is computed here rather than left to a spreadsheet.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_earnings.read", query: statsQuerySchema },
  async ({ query }) => ok(await earningsSummary(query)),
);
