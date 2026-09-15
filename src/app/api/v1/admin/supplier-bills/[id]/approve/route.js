import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approveSupplierBill } from "@/server/services/supplier-bill.service";

/**
 * Approving is the point at which the restaurant agrees it owes the money, so
 * it is when the bill reaches the ledger — and why it is its own permission.
 */
export const POST = apiHandler(
  { auth: true, permissions: "supplier_bills.approve", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await approveSupplierBill(params.id, auth)),
);
