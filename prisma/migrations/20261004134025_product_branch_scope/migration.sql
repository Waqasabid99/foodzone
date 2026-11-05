-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "Product_branchId_isActive_idx" ON "Product"("branchId", "isActive");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
