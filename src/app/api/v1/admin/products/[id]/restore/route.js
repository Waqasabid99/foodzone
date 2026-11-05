import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { restoreProduct } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "products.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.restore", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params }) => ok(await restoreProduct(params.id)),
);
