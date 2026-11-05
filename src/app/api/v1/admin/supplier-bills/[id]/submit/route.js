import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { submitSupplierBill } from "@/server/services/supplier-bill.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const POST = apiHandler(
  { auth: true, permissions: "supplier_bills.create", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "supplierBill", params.id, "supplier_bills.create");
    return ok(await submitSupplierBill(params.id, auth));
  },
);
