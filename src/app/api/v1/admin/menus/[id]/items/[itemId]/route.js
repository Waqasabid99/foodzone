import { apiHandler, assertBranchAccess, ok, RateLimits } from "@/lib/api";
import { itemParamSchema, updateMenuItemSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, removeMenuItem, updateMenuItem } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * Changing a price on a menu is its own permission (`menu_items.update_price`):
 * a shift manager may 86 an item all night without ever being able to reprice it.
 *
 * The other fields arrange the menu — its section, its position, whether it is
 * recommended — and take `menus.update`, like adding or removing the item does.
 * Holding the price permission alone does not rearrange a menu.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: ["menu_items.update_price", "menus.update"],
    anyPermission: true,
    params: itemParamSchema,
    body: updateMenuItemSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.update", entityType: "MenuItem", entityId: ({ params }) => params.itemId },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    const branchId = await assertMenuAccess(auth, params.id, null);
    if (body.priceOverride !== undefined) assertBranchAccess(auth, branchId, "menu_items.update_price");
    if (Object.keys(body).some((key) => key !== "priceOverride")) assertBranchAccess(auth, branchId, "menus.update");
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
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await removeMenuItem({ menuId: params.id, itemId: params.itemId }));
  },
);
