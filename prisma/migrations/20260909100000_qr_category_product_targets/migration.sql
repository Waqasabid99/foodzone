-- QrCode gained CATEGORY and PRODUCT targets.
--
-- `QrTargetType` already declared both values, but the model had nowhere to
-- store which category or product a code pointed at, so neither value could be
-- used. These two nullable columns close that gap.
--
-- Additive and safe to run on live data: both columns are nullable and every
-- existing row keeps its current target.
--
-- ON DELETE SET NULL rather than CASCADE on purpose. A printed sticker is a
-- physical object already stuck to a table; deleting the product it points at
-- must leave the code alive to be repointed, not silently destroy it.

ALTER TABLE "QrCode" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "QrCode" ADD COLUMN "productId" TEXT;

ALTER TABLE "QrCode"
  ADD CONSTRAINT "QrCode_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QrCode"
  ADD CONSTRAINT "QrCode_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "QrCode_categoryId_idx" ON "QrCode"("categoryId");
CREATE INDEX "QrCode_productId_idx" ON "QrCode"("productId");
