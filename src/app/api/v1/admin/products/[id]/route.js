import { z } from "zod";
import { apiHandler, branchScope, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateProductSchema } from "@/server/validation/catalog.schemas";
import { deleteProduct, getProduct, updateProduct } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

const querySchema = z.object({ includeDeleted: z.stringbool().default(false) });

export const GET = apiHandler(
  { auth: true, permissions: "products.read", params: idParamSchema, query: querySchema },
  async ({ params, query, auth }) =>
    ok(await getProduct(params.id, { ...query, scope: branchScope(auth, "products.read") })),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "products.update",
    params: idParamSchema,
    body: updateProductSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.update", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body, auth }) => ok(await updateProduct(params.id, body, auth)),
);

/** Soft delete: order history keeps its reference, the product leaves every menu. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "products.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.delete", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params }) => ok(await deleteProduct(params.id)),
);
