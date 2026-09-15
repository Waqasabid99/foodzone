import { apiHandler, ok, RateLimits } from "@/lib/api";
import { branchHoursSchema, idParamSchema } from "@/server/validation/schemas";
import { setBranchHours } from "@/server/services/branch.service";
import { invalidate } from "@/lib/revalidate";
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
    branch: "param",
    body: branchHoursSchema,
    rateLimit: RateLimits.write,
    audit: { action: "branch.set_hours", entityType: "Branch" },
  },
  async ({ params, body }) => {
    const hours = await setBranchHours({ branchId: params.id, hours: body.hours });
    // The cached outlet list carries `openState`, which these hours decide.
    invalidate(CacheTag.BRANCHES);
    return ok(hours);
  },
);
