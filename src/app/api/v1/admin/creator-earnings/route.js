import { apiHandler, ok } from "@/lib/api";
import { listEarningsSchema } from "@/server/validation/creator.schemas";
import { listEarnings } from "@/server/services/creator-earning.service";

/** Includes `NOT_QUALIFIED` rows: attributed sales that earned nothing. */
export const GET = apiHandler(
  { auth: true, permissions: "creator_earnings.read", query: listEarningsSchema },
  async ({ query }) => ok(await listEarnings(query)),
);
