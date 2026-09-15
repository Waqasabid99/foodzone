import { apiHandler, ok } from "@/lib/api";
import { statementQuerySchema } from "@/server/validation/creator.schemas";
import { appreciationFeed } from "@/server/services/creator-dashboard.service";

/**
 * The recognition feed.
 *
 * The non-monetary half of the answer for the large majority of creators who
 * will never earn much — including "your video drove a sale that missed the
 * threshold", which is the alternative to silence.
 */
export const GET = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard", query: statementQuerySchema },
  async ({ query, auth }) => ok(await appreciationFeed({ userId: auth.userId, ...query })),
);
