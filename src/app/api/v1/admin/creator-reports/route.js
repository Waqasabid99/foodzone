import { apiHandler, ok } from "@/lib/api";
import { listReportsSchema } from "@/server/validation/creator.schemas";
import { listReports } from "@/server/services/creator-video.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_videos.review", query: listReportsSchema },
  async ({ query }) => ok(await listReports(query)),
);
