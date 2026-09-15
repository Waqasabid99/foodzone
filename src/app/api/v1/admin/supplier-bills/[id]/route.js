import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getSupplierBill } from "@/server/services/supplier-bill.service";

export const GET = apiHandler(
  { auth: true, permissions: "supplier_bills.read", params: idParamSchema },
  async ({ params }) => ok(await getSupplierBill(params.id)),
);
