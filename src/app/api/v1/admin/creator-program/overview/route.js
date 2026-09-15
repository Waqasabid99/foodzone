import { apiHandler, ok } from "@/lib/api";
import { statsQuerySchema } from "@/server/validation/creator.schemas";
import { programOverview } from "@/server/services/creator-dashboard.service";

/** Includes `outstandingCredit` — the program's unspent liability. */
export const GET = apiHandler(
  { auth: true, permissions: "creators.read", query: statsQuerySchema },
  async ({ query }) => ok(await programOverview(query)),
);
