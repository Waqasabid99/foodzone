import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { publicCategories } from "@/server/services/catalog.service";

/** Active categories with a published-product count. No auth. */
const querySchema = z.object({ tree: z.stringbool().default(false) });

export const GET = apiHandler(
  { query: querySchema, rateLimit: RateLimits.public, scope: "catalog:categories" },
  async ({ query }) => ok(await publicCategories(query)),
);
