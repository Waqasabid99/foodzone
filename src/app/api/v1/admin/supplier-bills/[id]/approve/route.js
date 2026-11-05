import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approveSupplierBill } from "@/server/services/supplier-bill.service";
import { assertRecordAccess } from "@/server/purchasing/access";

/**
 * Approving is the point at which the restaurant agrees it owes the money, so
 * it is when the bill reaches the ledger — and why it is its own permission.
 */
export const POST = apiHandler(
  { auth: true, permissions: "supplier_bills.approve", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "supplierBill", params.id, "supplier_bills.approve");
    return ok(await approveSupplierBill(params.id, auth));
  },
);
