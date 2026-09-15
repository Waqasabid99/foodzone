import { apiHandler, ok, RateLimits } from "@/lib/api";
import { slugParamSchema } from "@/server/validation/catalog.schemas";
import { publicProduct } from "@/server/services/catalog.service";

/** Everything the order form needs: variants, modifier rules, combo slots. */
export const GET = apiHandler(
  { params: slugParamSchema, rateLimit: RateLimits.public, scope: "catalog:product" },
  async ({ params }) => ok(await publicProduct(params.slug)),
);
