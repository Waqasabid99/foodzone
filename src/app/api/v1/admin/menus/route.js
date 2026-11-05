import { apiHandler, assertBranchAccess, branchScope, created, paginated, RateLimits } from "@/lib/api";
import { createMenuSchema, menuQuerySchema } from "@/server/validation/catalog.schemas";
import { createMenu, listMenus } from "@/server/services/menu.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * Narrowed to the branches the caller may read menus at. `branch: "query"`
 * only checks a branch that was asked for; without one, a manager scoped to a
 * single outlet would otherwise list every branch's menus.
 */
export const GET = apiHandler(
  { auth: true, permissions: "menus.read", query: menuQuerySchema, branch: "query" },
  async ({ auth, query }) => {
    const { items, nextCursor, limit } = await listMenus({ ...query, scope: branchScope(auth, "menus.read") });
    return paginated(items, { nextCursor, limit });
  },
);

/**
 * Created switched off unless `isActive` is sent — and sending it takes
 * `menus.publish`, the same split as products: building a menu and putting it
 * in front of customers are different decisions.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.create",
    body: createMenuSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "menu.create", entityType: "Menu", entityId: ({ result }) => result?.id ?? null },
    invalidates: [CacheTag.MENUS],
  },
  async ({ auth, body }) => {
    if (body.isActive) assertBranchAccess(auth, body.branchId, "menus.publish");
    return created(await createMenu(body));
  },
);
