import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { restoreProduct } from "@/server/services/product.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "products.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.restore", entityType: "Product" },
  },
  async ({ params }) => ok(await restoreProduct(params.id)),
);
