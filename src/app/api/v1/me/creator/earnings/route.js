import { apiHandler, ok } from "@/lib/api";
import { listEarningsSchema } from "@/server/validation/creator.schemas";
import { creatorForUser } from "@/server/services/creator.service";
import { listEarnings } from "@/server/services/creator-earning.service";

/** Own earnings only — the creator id comes from the session, not the query. */
export const GET = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard", query: listEarningsSchema },
  async ({ query, auth }) => {
    const creator = await creatorForUser(auth.userId);
    return ok(await listEarnings({ ...query, creatorId: creator.id }));
  },
);
