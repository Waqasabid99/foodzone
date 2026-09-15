import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { branchQuerySchema, createBranchSchema } from "@/server/validation/schemas";
import { createBranch, listBranches } from "@/server/services/branch.service";
import { invalidate } from "@/lib/revalidate";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "branches.read", query: branchQuerySchema },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listBranches(query);
    return paginated(items, { nextCursor, limit });
  },
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "branches.create",
    body: createBranchSchema,
    rateLimit: RateLimits.write,
    audit: { action: "branch.create", entityType: "Branch" },
  },
  async ({ auth, body }) => {
    const branch = await createBranch(body, auth);
    // The storefront caches the outlet list for ten minutes; a new restaurant
    // should not wait that long to be orderable from.
    invalidate(CacheTag.BRANCHES);
    return created(branch);
  },
);
