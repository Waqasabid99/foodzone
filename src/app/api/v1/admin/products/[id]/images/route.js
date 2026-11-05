import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setImagesSchema } from "@/server/validation/catalog.schemas";
import { setProductImages } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

/** Replace-all: the gallery editor sends the whole ordered list. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "products.update",
    params: idParamSchema,
    body: setImagesSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.set_images", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body }) => ok(await setProductImages(params.id, body.images)),
);
