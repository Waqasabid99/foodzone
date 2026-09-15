import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { recordBillPaymentSchema } from "@/server/validation/finance.schemas";
import { recordBillPayment } from "@/server/services/supplier-bill.service";

/**
 * Records a payment against a bill.
 *
 * Overpayment is refused: it is nearly always a duplicate or a keying error,
 * and it would create a negative payable that understates what is owed across
 * the whole supplier ledger.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "supplier_bills.record_payment",
    params: idParamSchema,
    body: recordBillPaymentSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => created(await recordBillPayment(params.id, body, auth)),
);
