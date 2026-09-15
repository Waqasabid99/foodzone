import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateSupplierSchema } from "@/server/validation/inventory.schemas";
import { deleteSupplier, getSupplier, updateSupplier } from "@/server/services/supplier.service";

export const GET = apiHandler(
  { auth: true, permissions: "suppliers.read", params: idParamSchema },
  async ({ params }) => ok(await getSupplier(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "suppliers.update",
    params: idParamSchema,
    body: updateSupplierSchema,
    rateLimit: RateLimits.write,
    audit: { action: "supplier.update", entityType: "Supplier" },
  },
  async ({ params, body }) => ok(await updateSupplier(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "suppliers.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "supplier.delete", entityType: "Supplier" },
  },
  async ({ params }) => ok(await deleteSupplier(params.id)),
);
