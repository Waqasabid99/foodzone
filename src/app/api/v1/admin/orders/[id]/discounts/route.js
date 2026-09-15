import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { manualDiscountSchema } from "@/server/validation/pricing.schemas";
import { applyManualDiscount, orderDiscounts } from "@/server/services/discount.service";

export const GET = apiHandler(
  { auth: true, permissions: "orders.read", params: idParamSchema },
  async ({ params }) => ok(await orderDiscounts(params.id)),
);

/**
 * Applies a manual discount.
 *
 * `orders.apply_manual_discount` is deliberately separate from `orders.update`:
 * the person who fixes a typo in a delivery note is not automatically the
 * person who may hand out money.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "orders.apply_manual_discount",
    params: idParamSchema,
    body: manualDiscountSchema,
    rateLimit: RateLimits.write,
    // No declarative audit here: the service writes a richer entry inline —
    // amount, reason, and the totals either side — and does it synchronously
    // rather than after the response. Declaring one here as well would leave
    // two rows per giveaway, the emptier of which lands last.
  },
  async ({ params, body, auth, ipAddress, userAgent }) =>
    created(
      await applyManualDiscount({
        orderId: params.id,
        ...body,
        actor: auth,
        context: { ipAddress, userAgent },
      }),
    ),
);
