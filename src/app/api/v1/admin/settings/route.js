import { apiHandler, ok, RateLimits } from "@/lib/api";
import { settingsQuerySchema, updateSettingsSchema } from "@/server/validation/schemas";
import { describeSettings, updateSettings } from "@/server/services/setting.service";

/** The registry plus current values and which layer each one comes from. */
export const GET = apiHandler(
  { auth: true, permissions: "settings.read", query: settingsQuerySchema },
  async ({ query }) => ok(await describeSettings({ branchId: query.branchId ?? null })),
);

/**
 * Bulk write, validated per key against the registry. All-or-nothing: a partial
 * save would leave pricing half-updated.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "settings.update",
    body: updateSettingsSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "settings.update", entityType: "Setting" },
  },
  async ({ auth, body }) =>
    ok(await updateSettings({ values: body.values, branchId: body.branchId ?? null, actorId: auth.userId })),
);
