-- Where this person wants the workspace to open.
--
-- Null means "decide from what I do here": a cook lands on the kitchen board,
-- everybody else on the overview. Set, it wins — a head chef who wants the
-- overview and a manager who wants the board are both reasonable, and no rule
-- written in code can tell which is which.
ALTER TABLE "User" ADD COLUMN "homePage" TEXT;
