import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { categoryQuerySchema, createCategorySchema } from "@/server/validation/catalog.schemas";
import { createCategory, listCategories } from "@/server/services/category.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "categories.read", query: categoryQuerySchema },
  async ({ query }) => ok(await listCategories(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "categories.create",
    body: createCategorySchema,
    rateLimit: RateLimits.write,
    audit: { action: "category.create", entityType: "Category", entityId: ({ result }) => result?.id ?? null },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ body }) => created(await createCategory(body)),
);
