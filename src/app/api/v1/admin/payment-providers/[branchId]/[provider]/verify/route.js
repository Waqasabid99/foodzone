import { apiHandler, ok, RateLimits } from "@/lib/api";
import { providerParamsSchema } from "@/server/validation/payment-provider.schemas";
import { verifyBranchProvider } from "@/server/services/payment-provider.service";

/**
 * Tries a branch's stored credentials against the gateway.
 *
 * Answers 200 whether or not the credentials worked — "your key is wrong" is a
 * result the screen has to show, not a failed request. The outcome is in the
 * body, and it is recorded on the row so the list can say when a gateway was
 * last known to work.
 *
 * Rate-limited as a write even though it changes nothing of substance: it
 * makes an outbound call to a third party on every hit.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payment_providers.manage",
    params: providerParamsSchema,
    branch: "params",
    rateLimit: RateLimits.write,
  },
  async ({ auth, params }) =>
    ok(
      await verifyBranchProvider({
        branchId: params.branchId,
        provider: params.provider,
        actor: { userId: auth.userId },
      }),
    ),
);
