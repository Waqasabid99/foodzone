import { apiHandler, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { getBranch } from "@/server/services/branch.service";

/** Accepts either the branch id or its human code ("FZ-DT-01"). */
const paramsSchema = z.object({ id: z.string().min(1).max(64) });
const querySchema = z.object({
  channel: z.enum(["WEB", "MOBILE_APP", "QR", "POS", "PHONE", "AGGREGATOR"]).optional(),
});

export const GET = apiHandler(
  { params: paramsSchema, query: querySchema, rateLimit: RateLimits.public, scope: "branches:public-detail" },
  async ({ params, query }) => ok(await getBranch(params.id, { channel: query.channel ?? null })),
);
