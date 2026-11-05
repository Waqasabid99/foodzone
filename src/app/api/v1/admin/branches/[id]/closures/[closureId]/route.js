import { apiHandler, noContent, RateLimits } from "@/lib/api";
import { z } from "zod";
import { deleteClosure } from "@/server/services/branch.service";
import { CacheTag } from "@/lib/cache-tags";

const paramsSchema = z.object({ id: z.string().min(1), closureId: z.string().min(1) });

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "branches.manage_hours",
    params: paramsSchema,
    branch: "param:id",
    rateLimit: RateLimits.write,
    audit: { action: "branch.closure_delete", entityType: "Branch" },
    invalidates: [CacheTag.BRANCHES],
  },
  async ({ params }) => {
    await deleteClosure({ branchId: params.id, closureId: params.closureId });
    return noContent();
  },
);
