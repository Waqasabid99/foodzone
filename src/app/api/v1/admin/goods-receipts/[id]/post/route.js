import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { postGoodsReceipt } from "@/server/services/goods-receipt.service";

/**
 * Posts the receipt: stock in, batches created, the order updated.
 *
 * One transaction, and idempotent at the document level — a completed receipt
 * is returned unchanged rather than posted twice, because a double-posted
 * delivery is stock that never arrived. Freight is spread across the lines
 * before the batch is priced, so the batch cost is the true landed cost rather
 * than the invoice price.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "goods_receipts.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await postGoodsReceipt(params.id, auth)),
);
