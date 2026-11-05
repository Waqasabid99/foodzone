-- Bring-your-own gateway credentials, held per branch.
--
-- The restaurant is the merchant of record, so there is no deployment-wide
-- gateway secret. Secret fields in `credentials` are sealed envelopes bound to
-- (branchId, provider, field); public fields are stored readable.

CREATE TYPE "PaymentProviderMode" AS ENUM ('SANDBOX', 'LIVE');

CREATE TABLE "BranchPaymentProvider" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mode" "PaymentProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "keyId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerifyError" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPaymentProvider_pkey" PRIMARY KEY ("id")
);

-- One row per gateway per branch: two rows for the same gateway would make
-- "which credentials are live" ambiguous.
CREATE UNIQUE INDEX "BranchPaymentProvider_branchId_provider_key"
    ON "BranchPaymentProvider"("branchId", "provider");

CREATE INDEX "BranchPaymentProvider_branchId_isEnabled_idx"
    ON "BranchPaymentProvider"("branchId", "isEnabled");

ALTER TABLE "BranchPaymentProvider"
    ADD CONSTRAINT "BranchPaymentProvider_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
