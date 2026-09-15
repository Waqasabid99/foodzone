import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { submitSupplierBill } from "@/server/services/supplier-bill.service";

export const POST = apiHandler(
  { auth: true, permissions: "supplier_bills.create", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await submitSupplierBill(params.id, auth)),
);
