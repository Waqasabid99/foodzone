-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_branchId_scheduledFor_idx" ON "Order"("branchId", "scheduledFor");
