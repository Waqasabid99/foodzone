import { apiHandler, branchScope, created, paginated, RateLimits } from "@/lib/api";
import { adminProductQuerySchema, createProductSchema } from "@/server/validation/catalog.schemas";
import { createProduct, listProducts } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * Scoped to the branches the caller may read products at. A product with no
 * branch belongs to the whole chain and is listed for everyone; one pinned to
 * an outlet is listed only there.
 */
export const GET = apiHandler(
  { auth: true, permissions: "products.read", query: adminProductQuerySchema, branch: "query" },
  async ({ auth, query }) => {
    const { items, nextCursor, limit } = await listProducts({
      ...query,
      scope: branchScope(auth, "products.read"),
    });
    return paginated(items, { nextCursor, limit });
  },
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "products.create",
    body: createProductSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.create", entityType: "Product", entityId: ({ result }) => result?.id ?? null },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ auth, body }) => created(await createProduct(body, auth)),
);
