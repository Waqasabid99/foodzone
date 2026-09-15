import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema, updateBranchSchema } from "@/server/validation/schemas";
import { getBranch, updateBranch } from "@/server/services/branch.service";
import { invalidate } from "@/lib/revalidate";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "branches.read", params: idParamSchema, branch: "param" },
  async ({ params }) => ok(await getBranch(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "branches.update",
    params: idParamSchema,
    branch: "param",
    body: updateBranchSchema,
    rateLimit: RateLimits.write,
    audit: { action: "branch.update", entityType: "Branch" },
  },
  async ({ params, body }) => {
    const branch = await updateBranch(params.id, body);
    // Covers the case that matters most: deactivating an outlet has to remove
    // it from the location picker now, not at the end of the cache window.
    invalidate(CacheTag.BRANCHES);
    return ok(branch);
  },
);
