import { apiHandler, ok, RateLimits } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { slugParamSchema } from "@/server/validation/catalog.schemas";
import { paginationQuerySchema } from "@/server/validation/ordering.schemas";
import { productReviews } from "@/server/services/review.service";

/**
 * Published reviews for a product, with its rating summary.
 *
 * The distribution comes back alongside the average because "4.2 from 500" and
 * "4.2 from 5" are very different claims, and a bare average hides which.
 */
export const GET = apiHandler(
  { params: slugParamSchema, query: paginationQuerySchema, rateLimit: RateLimits.public, scope: "reviews:public" },
  async ({ params, query }) => {
    const product = await prisma.product.findFirst({
      where: { OR: [{ slug: params.slug }, { id: params.slug }], isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw ApiError.notFound("Product not found");

    return ok(await productReviews({ productId: product.id, ...query }));
  },
);
