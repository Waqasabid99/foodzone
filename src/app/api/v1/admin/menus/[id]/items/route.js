import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { addMenuItemSchema, menuItemQuerySchema } from "@/server/validation/catalog.schemas";
import { addMenuItem, assertMenuAccess, listMenuItems } from "@/server/services/menu.service";

export const GET = apiHandler(
  { auth: true, permissions: "menu_items.read", params: idParamSchema, query: menuItemQuerySchema },
  async ({ auth, params, query }) => {
    await assertMenuAccess(auth, params.id, "menu_items.read");
    const { items, nextCursor, limit } = await listMenuItems({ menuId: params.id, ...query });
    return paginated(items, { nextCursor, limit });
  },
);

/**
 * Adds a product to the menu. Without `variantId` every active variant is
 * added — one row each, so sizes can be priced and 86'd independently.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: idParamSchema,
    body: addMenuItemSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.create", entityType: "MenuItem" },
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return created(await addMenuItem(params.id, body));
  },
);
