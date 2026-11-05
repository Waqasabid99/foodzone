import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { cancelTransfer } from "@/server/services/stock-transfer.service";
import { assertTransferEnd } from "@/server/inventory/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_transfers.approve",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertTransferEnd(auth, params.id, "from", "stock_transfers.approve");
    return ok(await cancelTransfer(params.id, { reason: body?.reason ?? null }));
  },
);
