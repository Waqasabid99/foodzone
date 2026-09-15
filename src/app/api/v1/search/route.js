import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { searchCatalog } from "@/server/services/catalog.service";

const querySchema = z.object({
  q: z.string().trim().min(2, "Search for at least 2 characters").max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** One round trip populates the whole search screen: products and categories. */
export const GET = apiHandler(
  { query: querySchema, rateLimit: RateLimits.public, scope: "catalog:search" },
  async ({ query }) => ok(await searchCatalog({ search: query.q, limit: query.limit })),
);
