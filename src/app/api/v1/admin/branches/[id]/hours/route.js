import { apiHandler, ok, RateLimits } from "@/lib/api";
import { branchHoursSchema, idParamSchema } from "@/server/validation/schemas";
import { setBranchHours } from "@/server/services/branch.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * Replaces the branch's whole weekly schedule. PUT, not PATCH: editing hours is
 * always "here is the new week", and merging would leave a stale window alive.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "branches.manage_hours",
    params: idParamSchema,
    branch: "param:id",
    body: branchHoursSchema,
    rateLimit: RateLimits.write,
    audit: { action: "branch.set_hours", entityType: "Branch" },
    invalidates: [CacheTag.BRANCHES],
  },
  // The cached outlet list carries `openState`, which these hours decide.
  async ({ params, body }) => ok(await setBranchHours({ branchId: params.id, hours: body.hours })),
);
