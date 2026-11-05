import { apiHandler, assertBranchAccess, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateMenuSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, deleteMenu, getMenu, updateMenu } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "menus.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.read");
    return ok(await getMenu(params.id));
  },
);

/** Switching a menu on or off is publishing it, and takes `menus.publish` as well. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "menus.update",
    params: idParamSchema,
    body: updateMenuSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu.update", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params, body }) => {
    const branchId = await assertMenuAccess(auth, params.id, "menus.update");
    if (body.isActive !== undefined) assertBranchAccess(auth, branchId, "menus.publish");
    return ok(await updateMenu(params.id, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "menus.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu.delete", entityType: "Menu" },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, params }) => {
    await assertMenuAccess(auth, params.id, "menus.delete");
    return ok(await deleteMenu(params.id));
  },
);
