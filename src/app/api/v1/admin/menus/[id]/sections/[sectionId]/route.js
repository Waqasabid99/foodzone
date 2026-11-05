import { apiHandler, ok, RateLimits } from "@/lib/api";
import { sectionParamSchema, updateSectionSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, deleteSection, updateSection } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: sectionParamSchema,
    body: updateSectionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_section.update", entityType: "MenuSection", entityId: ({ params }) => params.sectionId },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await updateSection({ menuId: params.id, sectionId: params.sectionId, data: body }));
  },
);

/** Items survive; they return to the menu's unsectioned pool. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: sectionParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_section.delete", entityType: "MenuSection", entityId: ({ params }) => params.sectionId },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return ok(await deleteSection({ menuId: params.id, sectionId: params.sectionId }));
  },
);
