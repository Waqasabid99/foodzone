import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { orderPayments } from "@/server/services/payment.service";

/** What was taken against one order, what came back, and what is still owed. */
export const GET = apiHandler(
  { auth: true, permissions: "payments.read", params: idParamSchema },
  async ({ params }) => ok(await orderPayments(params.id)),
);
