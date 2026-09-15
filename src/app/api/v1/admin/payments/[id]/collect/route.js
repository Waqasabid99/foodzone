import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { markCollectedSchema } from "@/server/validation/payment.schemas";
import { markCollected } from "@/server/services/payment.service";

/**
 * Marks cash or COD as collected.
 *
 * Its own permission and its own endpoint, because this is the moment physical
 * money enters the business: it lands in a register session and becomes part of
 * that shift's expected cash. Capturing without a drawer would be cash nobody
 * notices is missing.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payments.mark_collected",
    params: idParamSchema,
    body: markCollectedSchema,
    rateLimit: RateLimits.write,
    audit: { action: "payment.collect", entityType: "Payment" },
  },
  async ({ params, body, auth }) =>
    ok(await markCollected({ paymentId: params.id, registerSessionId: body?.registerSessionId ?? null, actor: auth })),
);
