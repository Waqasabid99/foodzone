import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { publicCreator } from "@/server/services/creator.service";
import { videoFeed } from "@/server/services/creator-engagement.service";

const paramsSchema = z.object({ handle: z.string().trim().min(1).max(40) });

/**
 * A creator's public page.
 *
 * A suspended or banned creator is a plain 404 rather than a page saying so —
 * the storefront is not the place to publish a moderation outcome.
 */
export const GET = apiHandler({ auth: false, params: paramsSchema }, async ({ params }) => {
  const creator = await publicCreator(params.handle);
  const videos = await videoFeed({ creatorHandle: params.handle, limit: 24 });

  return ok({ creator, videos: videos.items });
});
