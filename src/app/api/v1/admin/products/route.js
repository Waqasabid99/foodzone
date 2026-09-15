import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { adminProductQuerySchema, createProductSchema } from "@/server/validation/catalog.schemas";
import { createProduct, listProducts } from "@/server/services/product.service";

export const GET = apiHandler(
  { auth: true, permissions: "products.read", query: adminProductQuerySchema },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listProducts(query);
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
  },
  async ({ auth, body }) => created(await createProduct(body, auth)),
);
