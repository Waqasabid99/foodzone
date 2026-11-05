import { apiHandler, assertCompanyWide, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { inventoryCategorySchema } from "@/server/validation/inventory.schemas";
import { deleteInventoryCategory, updateInventoryCategory } from "@/server/services/uom.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "inventory_categories.manage",
    params: idParamSchema,
    body: inventoryCategorySchema.partial(),
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    assertCompanyWide(auth, "inventory_categories.manage");
    return ok(await updateInventoryCategory(params.id, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "inventory_categories.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => {
    assertCompanyWide(auth, "inventory_categories.manage");
    return ok(await deleteInventoryCategory(params.id));
  },
);
