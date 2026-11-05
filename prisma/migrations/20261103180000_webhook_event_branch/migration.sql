-- Which branch's gateway account a callback came from.
--
-- Gateways are per-restaurant, so a callback can only be verified against that
-- branch's signing secret. Stored so a replay resolves the same credentials the
-- original verification used. Nullable: rows written before this change had no
-- branch, and backfilling them would be inventing data.
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "branchId" TEXT;

CREATE INDEX "PaymentWebhookEvent_branchId_createdAt_idx"
    ON "PaymentWebhookEvent"("branchId", "createdAt");
