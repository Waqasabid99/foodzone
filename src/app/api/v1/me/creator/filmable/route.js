import { apiHandler, ok } from "@/lib/api";
import { filmableOrderItems } from "@/server/services/creator-video.service";

/** Purchased lines still inside the submission window with no video yet. */
export const GET = apiHandler(
  { auth: true, permissions: "self.manage_own_videos" },
  async ({ auth }) => ok(await filmableOrderItems({ userId: auth.userId })),
);
