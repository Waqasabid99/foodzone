import { apiHandler, ok, RateLimits } from "@/lib/api";
import { programConfigSchema } from "@/server/validation/creator.schemas";
import { programConfig, updateProgramConfig } from "@/server/services/creator.service";

/**
 * Program settings.
 *
 * Typed columns rather than generic settings JSON, because every one of these
 * is a guardrail enforced in code — a mistyped key in a blob would silently
 * disable one rather than failing.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_program.configure" },
  async () => ok(await programConfig()),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "creator_program.configure",
    body: programConfigSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => ok(await updateProgramConfig(body, auth)),
);
