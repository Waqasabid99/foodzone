import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { receiveTransferSchema } from "@/server/validation/inventory.schemas";
import { receiveTransfer } from "@/server/services/stock-transfer.service";
import { assertTransferEnd } from "@/server/inventory/access";

/**
 * Stock arrives.
 *
 * Receiving less than was sent is allowed — breakage, theft, miscounting — and
 * the shortfall is written off at the source as wastage rather than silently
 * vanishing, because someone dispatched it and the loss belongs to that journey.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_transfers.receive",
    params: idParamSchema,
    body: receiveTransferSchema,
    rateLimit: RateLimits.write,
    audit: { action: "stock_transfer.receive", entityType: "StockTransfer" },
  },
  async ({ params, body, auth }) => {
    // Only the receiving side can say what arrived.
    await assertTransferEnd(auth, params.id, "to", "stock_transfers.receive");
    return ok(await receiveTransfer(params.id, { lines: body?.lines ?? [], actor: auth }));
  },
);
