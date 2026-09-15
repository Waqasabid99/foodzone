import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { writeOffBatchSchema } from "@/server/validation/inventory.schemas";
import { writeOffBatch } from "@/server/services/stock.service";

/**
 * Writes a batch off entirely.
 *
 * Posted as a WASTAGE movement rather than by editing the batch, so the loss
 * appears in the ledger, the wastage report and the cost of goods. Stock that
 * simply disappears from the numbers is stock nobody learns from.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_batches.write_off",
    params: idParamSchema,
    body: writeOffBatchSchema,
    rateLimit: RateLimits.write,
    audit: { action: "stock_batch.write_off", entityType: "StockBatch" },
  },
  async ({ params, body, auth }) => ok(await writeOffBatch({ batchId: params.id, ...body, actor: auth })),
);
