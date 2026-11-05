import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createSupplierBillSchema, listSupplierBillsSchema } from "@/server/validation/finance.schemas";
import { createSupplierBill, listSupplierBills } from "@/server/services/supplier-bill.service";
import { branchScope } from "@/lib/api/permissions";

export const GET = apiHandler(
  { auth: true, permissions: "supplier_bills.read", query: listSupplierBillsSchema, branch: "query" },
  async ({ query, auth }) => ok(await listSupplierBills({ ...query, scope: branchScope(auth, "supplier_bills.read") })),
);

/**
 * A supplier's invoice — a different event from the delivery, usually days
 * later. Until it arrives the obligation sits in "goods received not invoiced".
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "supplier_bills.create",
    body: createSupplierBillSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createSupplierBill(body, auth)),
);
