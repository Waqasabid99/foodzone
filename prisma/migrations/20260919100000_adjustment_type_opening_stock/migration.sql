-- Opening stock becomes its own kind of adjustment. It is inventory owned
-- before the system existed, so it posts to equity rather than to the period's
-- inventory variance. Existing adjustments are all corrections.
CREATE TYPE "StockAdjustmentType" AS ENUM ('CORRECTION', 'OPENING_STOCK');

ALTER TABLE "StockAdjustment" ADD COLUMN "type" "StockAdjustmentType" NOT NULL DEFAULT 'CORRECTION';
CREATE INDEX "StockAdjustment_type_status_idx" ON "StockAdjustment"("type", "status");

-- Stock added to a batch-tracked item arrives as a lot, or FIFO cannot draw it.
ALTER TABLE "StockAdjustmentItem" ADD COLUMN "batchNumber" TEXT;
ALTER TABLE "StockAdjustmentItem" ADD COLUMN "expiryDate" TIMESTAMP(3);
ALTER TABLE "StockAdjustmentItem" ADD COLUMN "batchId" TEXT;
