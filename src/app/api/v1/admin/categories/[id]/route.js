import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateCategorySchema } from "@/server/validation/catalog.schemas";
import { deleteCategory, getCategory, updateCategory } from "@/server/services/category.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "categories.read", params: idParamSchema },
  async ({ params }) => ok(await getCategory(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "categories.update",
    params: idParamSchema,
    body: updateCategorySchema,
    rateLimit: RateLimits.write,
    audit: { action: "category.update", entityType: "Category" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body }) => ok(await updateCategory(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "categories.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "category.delete", entityType: "Category" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params }) => ok(await deleteCategory(params.id)),
);
