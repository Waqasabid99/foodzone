import { apiHandler, ok, RateLimits } from "@/lib/api";
import { providerParamsSchema, saveProviderSchema } from "@/server/validation/payment-provider.schemas";
import { removeBranchProvider, saveBranchProvider } from "@/server/services/payment-provider.service";

/**
 * A branch's setup for one gateway.
 *
 * `payment_providers.manage` is held by very few people on purpose: whoever can
 * write here can point a restaurant's takings at a different merchant account.
 * Every write is audited by field name — never by value, because an audit trail
 * that quotes a credential is a second copy of it in a table more people can
 * read than the one it came from.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "payment_providers.manage",
    params: providerParamsSchema,
    body: saveProviderSchema,
    branch: "params",
    rateLimit: RateLimits.write,
  },
  async ({ auth, params, body }) =>
    ok(
      await saveBranchProvider({
        branchId: params.branchId,
        provider: params.provider,
        credentials: body.credentials ?? {},
        mode: body.mode ?? null,
        isEnabled: body.isEnabled ?? null,
        sortOrder: body.sortOrder ?? null,
        displayName: body.displayName,
        actor: { userId: auth.userId },
      }),
    ),
);

/**
 * Forgets a branch's credentials entirely.
 *
 * Deleting the row rather than blanking the fields, so nothing half-configured
 * is left behind to be switched on by accident later.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "payment_providers.manage",
    params: providerParamsSchema,
    branch: "params",
    rateLimit: RateLimits.write,
  },
  async ({ auth, params }) =>
    ok(
      await removeBranchProvider({
        branchId: params.branchId,
        provider: params.provider,
        actor: { userId: auth.userId },
      }),
    ),
);
