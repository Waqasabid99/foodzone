import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getVideo } from "@/server/services/creator-video.service";

export const GET = apiHandler(
  { auth: true, permissions: "self.manage_own_videos", params: idParamSchema },
  async ({ params, auth }) => ok(await getVideo(params.id, { userId: auth.userId })),
);
