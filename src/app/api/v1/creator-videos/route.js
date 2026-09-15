import { apiHandler, ok } from "@/lib/api";
import { feedQuerySchema } from "@/server/validation/creator.schemas";
import { videoFeed } from "@/server/services/creator-engagement.service";

/**
 * The public browse feed.
 *
 * Featured first, then most recently published — deliberately not ordered by
 * views. A feed ranked by popularity keeps whichever video went up first on top
 * for ever, and no new creator ever gets seen.
 */
export const GET = apiHandler({ auth: false, query: feedQuerySchema }, async ({ query }) => ok(await videoFeed(query)));
