import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { capturePaymentSchema } from "@/server/validation/payment.schemas";
import { capturePayment } from "@/server/services/payment.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "payments.capture",
    params: idParamSchema,
    body: capturePaymentSchema,
    rateLimit: RateLimits.write,
    audit: { action: "payment.capture", entityType: "Payment" },
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "payment", params.id, "payments.capture");
    return ok(await capturePayment({ paymentId: params.id, amount: body?.amount ?? null, actor: auth }));
  },
);
