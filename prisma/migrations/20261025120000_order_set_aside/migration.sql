-- A ticket the kitchen has taken off its board for somebody else to resolve.
--
-- Not a status: the sale is still live and still owed, and whether it ends in
-- a cancellation or a refund is a till decision rather than a kitchen one.
-- Clearing these three columns puts the ticket straight back up.
ALTER TABLE "Order" ADD COLUMN "setAsideAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "setAsideById" TEXT;
ALTER TABLE "Order" ADD COLUMN "setAsideReason" TEXT;

-- The kitchen board asks "which live orders are NOT set aside" on every poll.
CREATE INDEX "Order_branchId_setAsideAt_idx" ON "Order"("branchId", "setAsideAt");
