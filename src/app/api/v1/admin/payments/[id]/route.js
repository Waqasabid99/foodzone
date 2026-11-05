import { apiHandler, ok } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayment } from "@/server/services/payment.service";

export const GET = apiHandler(
  { auth: true, permissions: "payments.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "payment", params.id, "payments.read");
    return ok(await getPayment(params.id));
  },
);
