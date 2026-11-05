-- What a branch calls a gateway at checkout.
--
-- Optional. With several gateways enabled the options were indistinguishable —
-- every one read "Pay now by card or wallet" — so each needs a name. The
-- provider declares a presentable default; this overrides it per branch,
-- because the wording that works for one restaurant's customers is not the
-- wording that works for another's.
ALTER TABLE "BranchPaymentProvider" ADD COLUMN "displayName" TEXT;
