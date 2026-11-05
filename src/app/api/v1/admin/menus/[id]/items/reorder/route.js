import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reorderMenuProductsSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, reorderMenuProducts } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/** The menu's complete product order; every size of a product moves with it. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: idParamSchema,
    body: reorderMenuProductsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.reorder", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await reorderMenuProducts({ menuId: params.id, productIds: body.productIds }));
  },
);
