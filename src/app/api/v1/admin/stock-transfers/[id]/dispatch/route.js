import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { dispatchTransfer } from "@/server/services/stock-transfer.service";
import { assertTransferEnd } from "@/server/inventory/access";

/**
 * Stock leaves the source and is in transit.
 *
 * Two steps rather than one because a van carrying meat has left one place and
 * not arrived at the other. A single-step transfer would make that stock appear
 * instantly at the destination, and any shortfall on arrival would be invisible.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_transfers.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "stock_transfer.dispatch", entityType: "StockTransfer" },
  },
  async ({ params, auth }) => {
    await assertTransferEnd(auth, params.id, "from", "stock_transfers.approve");
    return ok(await dispatchTransfer(params.id, auth));
  },
);
