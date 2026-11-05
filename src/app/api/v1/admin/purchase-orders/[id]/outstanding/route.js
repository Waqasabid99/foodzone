import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { outstandingLines } from "@/server/services/purchase-order.service";
import { assertRecordAccess } from "@/server/purchasing/access";

/** What is still expected — the "chase the supplier" list. */
export const GET = apiHandler(
  { auth: true, permissions: "purchase_orders.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.read");
    return ok(await outstandingLines(params.id));
  },
);
