-- Yield loss on a production run is its own reason. Folding it into OTHER or
-- COOKING_ERROR would make the wastage report unable to separate normal trim
-- and evaporation from a batch somebody burnt.
ALTER TYPE "WastageReason" ADD VALUE IF NOT EXISTS 'PRODUCTION_LOSS' BEFORE 'COOKING_ERROR';
