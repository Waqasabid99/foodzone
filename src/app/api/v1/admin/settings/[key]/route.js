import { apiHandler, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { resetSetting } from "@/server/services/setting.service";

const paramsSchema = z.object({ key: z.string().min(1).max(120) });
const querySchema = z.object({ branchId: z.string().min(1).max(64).optional() });

/**
 * Removes an override so the value falls back to the layer beneath it: a branch
 * row falls back to global, a global row falls back to the code default.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "settings.update",
    params: paramsSchema,
    query: querySchema,
    rateLimit: RateLimits.write,
    audit: { action: "settings.reset", entityType: "Setting" },
  },
  async ({ params, query }) => ok(await resetSetting({ key: params.key, branchId: query.branchId ?? null })),
);
