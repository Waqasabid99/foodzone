import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { reviewQueue } from "@/server/services/creator-video.service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

/** Oldest submission first, so nobody waits for ever. */
export const GET = apiHandler(
  { auth: true, permissions: "creator_videos.review", query: querySchema },
  async ({ query }) => ok(await reviewQueue(query)),
);
