-- Viewer reporting of creator videos, removed.
--
-- The feature was half-built: a customer could report a video and a moderator
-- saw a count on the row, but there was never a screen to read what a report
-- said or to resolve one — so counts accumulated and never cleared. Rather
-- than finish it, the owner chose to drop it. Moderators still take videos
-- down and strike creators; what goes is the viewer-facing complaint channel.

DROP TABLE IF EXISTS "CreatorVideoReport";
DROP TYPE IF EXISTS "CreatorReportReason";
