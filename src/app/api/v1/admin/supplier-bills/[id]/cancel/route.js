import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { cancelBillSchema } from "@/server/validation/finance.schemas";
import { cancelSupplierBill } from "@/server/services/supplier-bill.service";
import { assertRecordAccess } from "@/server/purchasing/access";

/** An approved bill is already a payable, so cancelling reverses its entry. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "supplier_bills.approve",
    params: idParamSchema,
    body: cancelBillSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "supplierBill", params.id, "supplier_bills.approve");
    return ok(await cancelSupplierBill(params.id, { reason: body.reason, actor: auth }));
  },
);
