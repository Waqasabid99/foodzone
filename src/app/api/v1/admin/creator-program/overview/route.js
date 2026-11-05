import { apiHandler, branchScope, ok } from "@/lib/api";
import { can } from "@/lib/api/permissions";
import { statsQuerySchema } from "@/server/validation/creator.schemas";
import { programOverview } from "@/server/services/creator-dashboard.service";

/**
 * Includes `outstandingCredit` — the program's unspent liability.
 *
 * Two different gates, because this one endpoint mixes two kinds of fact.
 * Reaching it at all takes `creators.read`; the money inside it takes
 * `creator_earnings.read`, which a content moderator does not hold, and is
 * cut to the branches they hold it at. Figures they may not see come back
 * null rather than zero — a zero would read as "the programme paid nothing".
 */
export const GET = apiHandler(
  { auth: true, permissions: "creators.read", query: statsQuerySchema, branch: "query" },
  async ({ auth, query }) =>
    ok(
      await programOverview({
        ...query,
        includeMoney: can(auth, "creator_earnings.read"),
        scope: branchScope(auth, "creator_earnings.read"),
      }),
    ),
);
