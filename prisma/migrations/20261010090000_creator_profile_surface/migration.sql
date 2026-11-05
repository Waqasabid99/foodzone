-- A creator's own page is its own surface.
--
-- Folding it into VIDEO_FEED would have cost nothing to build and quietly
-- corrupted the one breakdown a programme manager actually reads: how many
-- sales came from people who went looking for a particular creator, versus
-- people browsing whatever was next.

ALTER TYPE "CreatorVideoSurface" ADD VALUE 'CREATOR_PROFILE' AFTER 'VIDEO_FEED';
