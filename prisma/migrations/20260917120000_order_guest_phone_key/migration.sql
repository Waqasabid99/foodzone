-- Guest orders (phone, counter and QR) are grouped into one customer by phone
-- number, and each is typed however the person taking it typed it. This stores
-- the comparable form — the last ten digits — so that grouping is an indexed
-- equality rather than a scan over every order with a regular expression.
ALTER TABLE "Order" ADD COLUMN "guestPhoneKey" TEXT;

-- Existing orders get the same reduction the application writes from now on.
UPDATE "Order"
SET "guestPhoneKey" = RIGHT(REGEXP_REPLACE("guestPhone", '[^0-9]', '', 'g'), 10)
WHERE "guestPhone" IS NOT NULL
  AND REGEXP_REPLACE("guestPhone", '[^0-9]', '', 'g') <> '';

CREATE INDEX "Order_guestPhoneKey_idx" ON "Order"("guestPhoneKey");
