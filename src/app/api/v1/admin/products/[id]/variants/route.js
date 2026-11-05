import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { variantInputSchema } from "@/server/validation/catalog.schemas";
import { addVariant, listVariants } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "variants.read", params: idParamSchema },
  async ({ params }) => ok(await listVariants(params.id)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "variants.create",
    params: idParamSchema,
    body: variantInputSchema,
    rateLimit: RateLimits.write,
    audit: { action: "variant.create", entityType: "ProductVariant" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body }) => created(await addVariant(params.id, body)),
);
