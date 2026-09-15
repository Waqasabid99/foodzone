import { apiHandler, assertBranchAccess, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { cloneMenuSchema } from "@/server/validation/catalog.schemas";
import { assertMenuAccess, cloneMenu, menuBranchId } from "@/server/services/menu.service";

/**
 * Copies a menu, with its sections and items, to another branch or channel.
 *
 * Two branch checks, not one, and neither can be expressed with the handler's
 * `branch` option because the target branch defaults to the source menu's own —
 * which is only known after a lookup. Checking just the source would let
 * somebody clone a menu into a branch they have no business touching; checking
 * just the target would let them read a menu they cannot otherwise see by
 * copying it to their own branch.
 *
 * The clone is created inactive unless `isActive` is set, and never inherits
 * the source's 86 state — see `cloneMenu`.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.create",
    params: idParamSchema,
    body: cloneMenuSchema,
    rateLimit: RateLimits.write,
    audit: { action: "menu.clone", entityType: "Menu", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ params, body, auth }) => {
    await assertMenuAccess(auth, params.id, "menus.read");

    const targetBranchId = body.branchId ?? (await menuBranchId(params.id));
    assertBranchAccess(auth, targetBranchId, "menus.create");

    return created(await cloneMenu(params.id, body));
  },
);
