import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { markPaidSchema } from "@/server/validation/delivery.schemas";
import { markPayoutPaid } from "@/server/services/driver-payout.service";

/**
 * Marks a payout paid, and clears the COD it deducted.
 *
 * The two go together: the deduction is only real once the money has actually
 * been settled. `cashInHand` is decremented rather than zeroed, because the
 * driver may have taken more COD since the payout was generated and that money
 * is still owed.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "driver_payouts.mark_paid",
    params: idParamSchema,
    body: markPaidSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) =>
    ok(await markPayoutPaid({ payoutId: params.id, paymentReference: body?.paymentReference ?? null, actor: auth })),
);
