-- Where a banner's artwork is cropped from.
--
-- The hero is a wide band and photography is not: a portrait photo dropped into
-- it shows its middle third. The editor now says which edge has to survive.
-- CENTER is what the existing banners were already getting.

CREATE TYPE "HeroFocus" AS ENUM ('TOP', 'CENTER', 'BOTTOM');

ALTER TABLE "HeroSlide" ADD COLUMN "focalPoint" "HeroFocus" NOT NULL DEFAULT 'CENTER';
