import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createVideoSchema, listVideosSchema } from "@/server/validation/creator.schemas";
import { createVideo, myVideos } from "@/server/services/creator-video.service";

export const GET = apiHandler(
  { auth: true, permissions: "self.manage_own_videos", query: listVideosSchema },
  async ({ query, auth }) => ok(await myVideos({ userId: auth.userId, ...query })),
);

/**
 * Starts a video against a purchased line.
 *
 * The order line is the whole authorisation: it proves the creator bought the
 * product, and it decides which product the video can go live against. Neither
 * is taken from the request.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.manage_own_videos",
    body: createVideoSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createVideo({ userId: auth.userId, ...body })),
);
