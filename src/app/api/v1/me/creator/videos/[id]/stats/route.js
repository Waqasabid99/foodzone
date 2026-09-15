import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { statsQuerySchema } from "@/server/validation/creator.schemas";
import { getVideo } from "@/server/services/creator-video.service";
import { videoStats } from "@/server/services/creator-engagement.service";

export const GET = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard", params: idParamSchema, query: statsQuerySchema },
  async ({ params, query, auth }) => {
    // Ownership is proved by loading it as the creator before returning stats.
    await getVideo(params.id, { userId: auth.userId });
    return ok(await videoStats({ videoId: params.id, ...query }));
  },
);
