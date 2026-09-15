import { apiHandler, paginated, RateLimits } from "@/lib/api";
import { publicProductQuerySchema } from "@/server/validation/catalog.schemas";
import { publicProducts } from "@/server/services/catalog.service";

/**
 * The catalog-wide browse. Branch pricing and availability come from a menu —
 * see `/branches/{id}/menu`.
 */
export const GET = apiHandler(
  { query: publicProductQuerySchema, rateLimit: RateLimits.public, scope: "catalog:products" },
  async ({ query }) => {
    const { items, nextCursor, limit } = await publicProducts(query);
    return paginated(items, { nextCursor, limit });
  },
);
