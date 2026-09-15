import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getEarning } from "@/server/services/creator-earning.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_earnings.read", params: idParamSchema },
  async ({ params }) => ok(await getEarning(params.id)),
);
