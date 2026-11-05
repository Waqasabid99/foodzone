import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { addMenuProductsSchema } from "@/server/validation/catalog.schemas";
import { addMenuProducts, assertMenuAccess } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * Adds several products at once, every active size of each. Products that are
 * already on the menu, or have no active size, come back under `skipped`.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: idParamSchema,
    body: addMenuProductsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.bulk_create", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return created(await addMenuProducts(params.id, body));
  },
);
