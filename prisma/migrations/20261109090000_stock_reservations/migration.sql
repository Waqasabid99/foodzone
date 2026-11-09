-- Stock promised to an order that has not been cooked yet.
--
-- `StockLevel.reservedQuantity` has been modelled, read, and shown on screen
-- as `available = quantity - reserved` since inventory was built, and nothing
-- ever wrote it. So "available" was always equal to on-hand, and two
-- customers could each be sold the last portion.
--
-- These rows are what writes it. They stand to `reservedQuantity` exactly as
-- `StockMovement` stands to `quantity`: the truth behind a cache, so the cache
-- can be rebuilt and proven rather than trusted.

CREATE TYPE "StockReservationStatus" AS ENUM ('HELD', 'RELEASED', 'CONSUMED');

CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'HELD',
    "endedReason" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- One hold per item per location per order. An order whose lines change
-- adjusts the row it already has; without this a second round at a table
-- would stack a duplicate hold on top of the first and release only one.
CREATE UNIQUE INDEX "StockReservation_orderId_itemId_locationId_key"
    ON "StockReservation"("orderId", "itemId", "locationId");

-- How the cache is rebuilt: sum the held rows for an item at a location.
CREATE INDEX "StockReservation_itemId_locationId_status_idx"
    ON "StockReservation"("itemId", "locationId", "status");

-- How the sweeper finds holds that nobody is ever going to collect.
CREATE INDEX "StockReservation_status_createdAt_idx"
    ON "StockReservation"("status", "createdAt");

ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
