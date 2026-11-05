import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getSupplierBill } from "@/server/services/supplier-bill.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const GET = apiHandler(
  { auth: true, permissions: "supplier_bills.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "supplierBill", params.id, "supplier_bills.read");
    return ok(await getSupplierBill(params.id));
  },
);
