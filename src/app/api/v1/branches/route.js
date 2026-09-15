import { apiHandler, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { publicBranches } from "@/server/services/branch.service";

/**
 * Public branch list for the storefront and the app: active outlets only, with
 * opening hours and whether each is serving right now.
 */
const querySchema = z.object({
  channel: z.enum(["WEB", "MOBILE_APP", "QR", "POS", "PHONE", "AGGREGATOR"]).optional(),
});

export const GET = apiHandler(
  { query: querySchema, rateLimit: RateLimits.public, scope: "branches:public" },
  async ({ query }) => ok(await publicBranches({ channel: query.channel ?? null })),
);
