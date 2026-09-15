import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createPaymentSchema, listPaymentsSchema } from "@/server/validation/payment.schemas";
import { createPayment, listPayments } from "@/server/services/payment.service";

export const GET = apiHandler(
  { auth: true, permissions: "payments.read", query: listPaymentsSchema, branch: "query" },
  async ({ query }) => ok(await listPayments(query)),
);

/**
 * Starts a charge against an order.
 *
 * Idempotent when the caller supplies `idempotencyKey`: replaying the same key
 * returns the original payment rather than charging a second time. Clients
 * should always send one — a tap on a flaky connection is otherwise a double
 * charge the customer discovers on their statement.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payments.capture",
    body: createPaymentSchema,
    rateLimit: RateLimits.write,
    audit: { action: "payment.create", entityType: "Payment", entityId: ({ result }) => result?.payment?.id ?? null },
  },
  async ({ body, auth }) => created(await createPayment({ ...body, actor: auth })),
);
