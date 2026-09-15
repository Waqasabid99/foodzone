import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getVideo } from "@/server/services/creator-video.service";

/** Includes every attempt and every decision — the moderation history. */
export const GET = apiHandler(
  { auth: true, permissions: "creator_videos.read", params: idParamSchema },
  async ({ params }) => ok(await getVideo(params.id)),
);
