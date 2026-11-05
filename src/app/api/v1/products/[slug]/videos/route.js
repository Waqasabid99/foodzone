import { z } from "zod";
import { apiHandler, ok, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { videosForProduct } from "@/server/services/creator-engagement.service";

const paramsSchema = z.object({ slug: z.string().trim().min(1).max(200) });
const querySchema = z.object({
  /// Which outlet's page this is. Optional only for a single-restaurant
  /// installation, which has nothing to choose between.
  branchId: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

/** Customer videos on a product page. */
export const GET = apiHandler({ auth: false, params: paramsSchema, query: querySchema }, async ({ params, query }) => {
  const product = await prisma.product.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!product) throw ApiError.notFound("Product not found");

  return ok(await videosForProduct({ productId: product.id, branchId: query.branchId, limit: query.limit ?? 10 }));
});
