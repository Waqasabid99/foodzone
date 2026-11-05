import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { publicCreator } from "@/server/services/creator.service";
import { videosByCreator } from "@/server/services/creator-engagement.service";

const paramsSchema = z.object({ handle: z.string().trim().min(1).max(40) });
const querySchema = z.object({ branchId: z.string().trim().min(1).max(40).optional() });

/**
 * A creator's public page.
 *
 * A suspended or banned creator is a plain 404 rather than a page saying so —
 * the storefront is not the place to publish a moderation outcome.
 */
export const GET = apiHandler({ auth: false, params: paramsSchema, query: querySchema }, async ({ params, query }) => {
  const creator = await publicCreator(params.handle);
  const videos = await videosByCreator({ creatorHandle: params.handle, branchId: query.branchId ?? null, limit: 24 });

  return ok({ creator, videos });
});
