-- A creator video belongs to the outlet it was filmed at.
--
-- Three steps rather than one: the column arrives nullable, is filled from the
-- order each video was filmed against, and only then becomes required. Adding
-- it NOT NULL in one statement would need a default, and there is no sensible
-- default for "which outlet did this person eat at".

ALTER TABLE "CreatorVideo" ADD COLUMN "branchId" TEXT;

UPDATE "CreatorVideo" AS v
SET "branchId" = o."branchId"
FROM "Order" AS o
WHERE o."id" = v."orderId";

ALTER TABLE "CreatorVideo" ALTER COLUMN "branchId" SET NOT NULL;

ALTER TABLE "CreatorVideo"
  ADD CONSTRAINT "CreatorVideo_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CreatorVideo_branchId_status_publishedAt_idx"
  ON "CreatorVideo"("branchId", "status", "publishedAt");
