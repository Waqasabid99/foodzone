-- CartItem gained a place to store combo choices.
--
-- `modifiers` holds `[{ optionId, quantity }]` — ids of ModifierOption rows. A
-- combo choice is a different thing entirely: it points at a product and a
-- variant inside one of the combo's groups. Putting both in one column would
-- force every reader to disambiguate two unrelated shapes at runtime.
--
-- Additive and safe on live data: nullable, and every existing cart row keeps
-- working unchanged.

ALTER TABLE "CartItem" ADD COLUMN "comboSelections" JSONB;
