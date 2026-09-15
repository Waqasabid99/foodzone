import { apiHandler, ok, RateLimits } from "@/lib/api";
import { settingsQuerySchema } from "@/server/validation/schemas";
import { getSettings } from "@/server/services/setting.service";

/**
 * Settings both clients need before anyone signs in: store name, currency,
 * whether ordering is on, delivery fees, maintenance mode.
 *
 * Only entries flagged `isPublic` in the registry are returned — that flag is
 * the whole guard, so a new setting is private unless someone deliberately
 * marks it otherwise.
 */
export const GET = apiHandler(
  { query: settingsQuerySchema, rateLimit: RateLimits.public, scope: "settings:public" },
  async ({ query }) => ok(await getSettings({ branchId: query.branchId ?? null, publicOnly: true })),
);
