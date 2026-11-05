import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { closureSchema, idParamSchema } from "@/server/validation/schemas";
import { createClosure, listClosures } from "@/server/services/branch.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "branches.read", params: idParamSchema, branch: "param:id" },
  async ({ params }) => ok(await listClosures({ branchId: params.id })),
);

/** One-off shutdown: a holiday, a power cut, a kitchen problem. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "branches.manage_hours",
    params: idParamSchema,
    branch: "param:id",
    body: closureSchema,
    rateLimit: RateLimits.write,
    audit: { action: "branch.closure_create", entityType: "Branch" },
    invalidates: [CacheTag.BRANCHES],
  },
  async ({ auth, params, body }) =>
    created(await createClosure({ branchId: params.id, ...body, actorId: auth.userId })),
);
