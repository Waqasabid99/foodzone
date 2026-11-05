import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reorderSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, reorderSections } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: idParamSchema,
    body: reorderSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_section.reorder", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await reorderSections({ menuId: params.id, items: body.items }));
  },
);
