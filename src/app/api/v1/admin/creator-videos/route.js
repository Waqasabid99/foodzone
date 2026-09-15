import { apiHandler, ok } from "@/lib/api";
import { listVideosSchema } from "@/server/validation/creator.schemas";
import { listVideos } from "@/server/services/creator-video.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_videos.read", query: listVideosSchema },
  async ({ query }) => ok(await listVideos(query)),
);
