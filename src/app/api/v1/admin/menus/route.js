import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { createMenuSchema, menuQuerySchema } from "@/server/validation/catalog.schemas";
import { createMenu, listMenus } from "@/server/services/menu.service";

export const GET = apiHandler(
  { auth: true, permissions: "menus.read", query: menuQuerySchema, branch: "query" },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listMenus(query);
    return paginated(items, { nextCursor, limit });
  },
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "menus.create",
    body: createMenuSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "menu.create", entityType: "Menu", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body }) => created(await createMenu(body)),
);
