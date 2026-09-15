import { apiHandler, ok, RateLimits } from "@/lib/api";
import { reorderSchema } from "@/server/validation/catalog.schemas";
import { reorderCategories } from "@/server/services/category.service";

/** What a drag-and-drop admin screen sends once, on drop. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "categories.update",
    body: reorderSchema,
    rateLimit: RateLimits.write,
    audit: { action: "category.reorder", entityType: "Category" },
  },
  async ({ body }) => ok(await reorderCategories(body.items)),
);
