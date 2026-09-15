import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { supplierItemSchema } from "@/server/validation/inventory.schemas";
import { setSupplierItem } from "@/server/services/supplier.service";

/**
 * Adds or updates a price-list line.
 *
 * Upsert rather than create: a price list is a living document, and re-sending
 * a line after a price rise is the normal case, not a conflict.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "suppliers.update",
    params: idParamSchema,
    body: supplierItemSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body }) => ok(await setSupplierItem({ supplierId: params.id, ...body })),
);
