import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayment } from "@/server/services/payment.service";

export const GET = apiHandler(
  { auth: true, permissions: "payments.read", params: idParamSchema },
  async ({ params }) => ok(await getPayment(params.id)),
);
