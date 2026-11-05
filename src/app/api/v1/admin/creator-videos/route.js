import { apiHandler, branchScope, ok } from "@/lib/api";
import { listVideosSchema } from "@/server/validation/creator.schemas";
import { listVideos } from "@/server/services/creator-video.service";

/**
 * Scoped through the product each video sells: a video of a branch-owned
 * product belongs to that outlet, one of a chain-wide product to everybody.
 */
export const GET = apiHandler(
  { auth: true, permissions: "creator_videos.read", query: listVideosSchema, branch: "query" },
  async ({ auth, query }) => ok(await listVideos({ ...query, scope: branchScope(auth, "creator_videos.read") })),
);
