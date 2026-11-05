import { apiHandler, branchScope, created, paginated, RateLimits } from "@/lib/api";
import { branchQuerySchema, createBranchSchema } from "@/server/validation/schemas";
import { createBranch, listBranches } from "@/server/services/branch.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "branches.read", query: branchQuerySchema },
  async ({ auth, query }) => {
    // The permission check above asks whether this person may read branches
    // *anywhere*. A manager scoped to one outlet passes it, so the list is
    // narrowed to the outlets their grant actually covers — otherwise the
    // answer to "show me the branches" is the whole company.
    const scope = branchScope(auth, "branches.read");
    const { items, nextCursor, limit } = await listBranches({ ...query, scope });
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
    invalidates: [CacheTag.BRANCHES],
  },
  // The storefront caches the outlet list for ten minutes; a new restaurant
  // should not wait that long to be orderable from.
  async ({ auth, body }) => created(await createBranch(body, auth)),
);
