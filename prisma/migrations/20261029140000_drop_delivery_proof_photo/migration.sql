-- Proof of delivery is removed, like the door-step code before it.
--
-- A branch could require the driver to upload a photo before the job would
-- close. In practice that is a rider standing at the kerb with the customer
-- already back indoors, held up by an upload, on an order that is paid for
-- either way. A drop is done when the rider says it is.
--
-- `signatureUrl` goes with it: a column nothing in the codebase has ever
-- written to or read. Both held no data.
ALTER TABLE "Delivery" DROP COLUMN IF EXISTS "proofImageUrl";
ALTER TABLE "Delivery" DROP COLUMN IF EXISTS "signatureUrl";

-- The setting that switched it on, global and per-branch alike. A stored value
-- no code reads is how a removed feature comes back.
DELETE FROM "Setting" WHERE "key" = 'delivery.require_proof_photo';

-- `recipientName` stays. The driver may record who took the order, which costs
-- nobody anything and settles the drops that are later disputed.
