import { apiHandler, ok } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { getRefund } from "@/server/services/refund.service";

export const GET = apiHandler(
  { auth: true, permissions: "refunds.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "refund", params.id, "refunds.read");
    return ok(await getRefund(params.id));
  },
);
