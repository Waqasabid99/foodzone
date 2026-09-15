import { apiHandler, ok } from "@/lib/api";
import { statsQuerySchema } from "@/server/validation/creator.schemas";
import { videoPerformance } from "@/server/services/creator-dashboard.service";

/**
 * The funnel that matters: views to add-to-carts to orders.
 *
 * Views alone say nothing about whether a video sells — a thousand views with
 * no add-to-carts is a different problem from fifty views with ten.
 */
export const GET = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard", query: statsQuerySchema },
  async ({ query, auth }) => ok(await videoPerformance({ userId: auth.userId, ...query })),
);
