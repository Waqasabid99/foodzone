import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertOrderAccess, getOrder } from "@/server/services/order.service";

export const GET = apiHandler(
  { auth: true, permissions: "orders.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "orders.read");
    return ok(await getOrder(params.id));
  },
);
