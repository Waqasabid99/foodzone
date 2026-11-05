import { apiHandler, ok, RateLimits } from "@/lib/api";
import { availabilitySchema, itemParamSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, setMenuItemAvailability } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * The 86 switch — the most-used endpoint during service.
 *
 * `write` rate limits rather than the stricter ones: a busy kitchen legitimately
 * toggles items dozens of times an hour.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "menu_items.toggle_availability",
    params: itemParamSchema,
    body: availabilitySchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_item.availability", entityType: "MenuItem", entityId: ({ params }) => params.itemId },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menu_items.toggle_availability");
    return ok(
      await setMenuItemAvailability({
        menuId: params.id,
        itemId: params.itemId,
        isAvailable: body.isAvailable,
        until: body.until ?? null,
      }),
    );
  },
);
