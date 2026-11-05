import { apiHandler, ok, RateLimits } from "@/lib/api";
import { menuProductParamSchema, updateMenuProductSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, removeMenuProduct, updateMenuProduct } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * A product on a menu, across all of its sizes: which section it sits in and
 * whether it is recommended. Prices stay per size, on the item route.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: menuProductParamSchema,
    body: updateMenuProductSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_product.update", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await updateMenuProduct({ menuId: params.id, productId: params.productId, data: body }));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: menuProductParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_product.delete", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await removeMenuProduct({ menuId: params.id, productId: params.productId }));
  },
);
