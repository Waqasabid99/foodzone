import { apiHandler, ok, RateLimits } from "@/lib/api";
import { itemParamSchema, updateMenuItemSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, removeMenuItem, updateMenuItem } from "@/server/services/menu.service";

/**
 * Changing a price on a menu is its own permission (`menu_items.update_price`):
 * a shift manager may 86 an item all night without ever being able to reprice it.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "menu_items.update_price",
    params: itemParamSchema,
    body: updateMenuItemSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.update", entityType: "MenuItem", entityId: ({ params }) => params.itemId },
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menu_items.update_price");
    return ok(await updateMenuItem({ menuId: params.id, itemId: params.itemId, data: body }));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: itemParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.delete", entityType: "MenuItem", entityId: ({ params }) => params.itemId },
  },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await removeMenuItem({ menuId: params.id, itemId: params.itemId }));
  },
);
