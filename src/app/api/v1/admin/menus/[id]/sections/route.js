import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { createSectionSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, createSection, listSections } from "@/server/services/menu.service";

export const GET = apiHandler(
  { auth: true, permissions: "menus.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.read");
    return ok(await listSections(params.id));
  },
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: idParamSchema,
    body: createSectionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu_section.create", entityType: "MenuSection" },
  },
  async ({ auth, params, body }) => {
    await assertMenuAccess(auth, params.id, "menus.update");
    return created(await createSection(params.id, body));
  },
);
