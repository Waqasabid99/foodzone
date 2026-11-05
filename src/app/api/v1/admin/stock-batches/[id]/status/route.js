import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setBatchStatusSchema } from "@/server/validation/inventory.schemas";
import { setBatchStatus } from "@/server/services/stock.service";
import { assertRecordAccess } from "@/server/inventory/access";

/**
 * Quarantines a batch, or releases it.
 *
 * Not a write-off: a suspect delivery may turn out to be fine. The stock stays
 * on the books and in the valuation, but FIFO stops handing it out because
 * allocation only considers ACTIVE batches.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "stock_batches.quarantine",
    params: idParamSchema,
    body: setBatchStatusSchema,
    rateLimit: RateLimits.write,
    audit: { action: "stock_batch.set_status", entityType: "StockBatch" },
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "batch", params.id, "stock_batches.quarantine");
    return ok(await setBatchStatus({ batchId: params.id, ...body, actor: auth }));
  },
);
