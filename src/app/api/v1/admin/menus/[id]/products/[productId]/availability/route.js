import { apiHandler, ok, RateLimits } from "@/lib/api";
import { availabilitySchema, menuProductParamSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, setMenuProductAvailability } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/** Sold out, or back on, for every size of a product at once. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "menu_items.toggle_availability",
    params: menuProductParamSchema,
    body: availabilitySchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_product.availability", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menu_items.toggle_availability");
    return ok(
      await setMenuProductAvailability({
        menuId: params.id,
        productId: params.productId,
        isAvailable: body.isAvailable,
        until: body.until ?? null,
      }),
    );
  },
);
