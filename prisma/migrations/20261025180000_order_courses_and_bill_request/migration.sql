-- A second round at a table, and a table asking to settle.
--
-- `course` defaults to 1, so every line already on the books is the round the
-- order was placed with and nothing needs backfilling. `firedAt` stays null
-- for those: course 1 clocks from "Order"."placedAt".
ALTER TABLE "OrderItem" ADD COLUMN "course" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderItem" ADD COLUMN "firedAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD COLUMN "billRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "billRequestedById" TEXT;

-- The kitchen board reads one ticket per (order, course); the till reads which
-- tables are waiting to pay. Both run on every poll.
CREATE INDEX "OrderItem_orderId_course_idx" ON "OrderItem"("orderId", "course");
CREATE INDEX "Order_branchId_billRequestedAt_idx" ON "Order"("branchId", "billRequestedAt");
