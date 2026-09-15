import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getRefund } from "@/server/services/refund.service";

export const GET = apiHandler(
  { auth: true, permissions: "refunds.read", params: idParamSchema },
  async ({ params }) => ok(await getRefund(params.id)),
);
