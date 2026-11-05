import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getVideo } from "@/server/services/creator-video.service";
import { assertVideoAccess } from "@/server/creator/access";

/**
 * Includes every attempt and every decision — the moderation history.
 *
 * 404 rather than 403 for a video of another outlet's product: see
 * `server/creator/access.js`.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_videos.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertVideoAccess(auth, params.id, "creator_videos.read");
    return ok(await getVideo(params.id));
  },
);
