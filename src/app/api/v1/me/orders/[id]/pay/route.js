import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { idempotencyKeySchema, paymentMethodSchema } from "@/server/validation/payment.schemas";
import { getOwnOrder } from "@/server/services/order.service";
import { createPayment, orderPayments } from "@/server/services/payment.service";

/**
 * A customer paying for their own order.
 *
 * Note what the request cannot say: **the amount**. It names an order and a
 * method, and the server charges what that order still owes. The customer also
 * cannot choose an arbitrary provider or a cash-like method — marking one's own
 * order as "cash received" would be marking it paid for free, so the methods a
 * customer may pick are restricted to ones that actually move money through a
 * gateway.
 */
const bodySchema = z.object({
  method: paymentMethodSchema.refine(
    (method) => ["CARD", "UPI", "NET_BANKING", "WALLET"].includes(method),
    "Choose an online payment method",
  ),
  idempotencyKey: idempotencyKeySchema.optional(),
  returnUrl: z.url().max(2000).optional(),
});

export const GET = apiHandler(
  { auth: true, params: idParamSchema, scope: "me:orders" },
  async ({ auth, params }) => {
    await getOwnOrder({ id: params.id, userId: auth.userId });
    const summary = await orderPayments(params.id);

    // Narrowed deliberately: a customer needs to know what they owe and whether
    // it went through, not the gateway ids and raw responses staff use to
    // reconcile.
    return ok({
      orderId: summary.orderId,
      orderNumber: summary.orderNumber,
      currency: summary.currency,
      grandTotal: summary.grandTotal,
      amountDue: summary.amountDue,
      paymentState: summary.paymentState,
      payments: summary.payments.map((payment) => ({
        id: payment.id,
        method: payment.method,
        status: payment.status,
        amount: payment.amount,
        cardBrand: payment.cardBrand,
        cardLast4: payment.cardLast4,
        createdAt: payment.createdAt,
      })),
    });
  },
);

export const POST = apiHandler(
  { auth: true, params: idParamSchema, body: bodySchema, rateLimit: RateLimits.checkout, scope: "me:orders" },
  async ({ auth, params, body }) => {
    // Ownership first: this throws NOT_FOUND for someone else's order.
    await getOwnOrder({ id: params.id, userId: auth.userId });

    const result = await createPayment({
      orderId: params.id,
      method: body.method,
      idempotencyKey: body.idempotencyKey ?? null,
      returnUrl: body.returnUrl ?? null,
      actor: auth,
    });

    return created({
      paymentId: result.payment.id,
      status: result.payment.status,
      amount: result.payment.amount,
      currency: result.payment.currency,
      replayed: result.replayed,
      clientAction: result.clientAction,
    });
  },
);
