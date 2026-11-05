import { apiHandler, branchScope, ok } from "@/lib/api";
import { listEarningsSchema } from "@/server/validation/creator.schemas";
import { listEarnings } from "@/server/services/creator-earning.service";

/**
 * Includes `NOT_QUALIFIED` rows: attributed sales that earned nothing.
 *
 * Scoped to the branches the caller may read earnings at. An earning is a
 * cost booked against one branch's completed order, and `creator_earnings.read`
 * sits on the accountant role — exactly the one an operator pins to a single
 * outlet.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_earnings.read", query: listEarningsSchema, branch: "query" },
  async ({ auth, query }) => ok(await listEarnings({ ...query, scope: branchScope(auth, "creator_earnings.read") })),
);
