import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { voidPaymentSchema } from "@/server/validation/payment.schemas";
import { voidPayment } from "@/server/services/payment.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "payments.void",
    params: idParamSchema,
    body: voidPaymentSchema,
    rateLimit: RateLimits.write,
    audit: { action: "payment.void", entityType: "Payment" },
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "payment", params.id, "payments.void");
    return ok(await voidPayment({ paymentId: params.id, reason: body?.reason ?? null }));
  },
);
