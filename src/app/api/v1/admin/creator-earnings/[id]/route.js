import { apiHandler, branchScope, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getEarning } from "@/server/services/creator-earning.service";

/** 404 rather than 403 for another branch's earning: see creator/access.js. */
export const GET = apiHandler(
  { auth: true, permissions: "creator_earnings.read", params: idParamSchema },
  async ({ params, auth }) => ok(await getEarning(params.id, { scope: branchScope(auth, "creator_earnings.read") })),
);
