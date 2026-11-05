-- The home page's front window: authored banners, scheduled.

CREATE TABLE "HeroSlide" (
  "id"          TEXT NOT NULL,
  "headline"    TEXT NOT NULL,
  "subtext"     TEXT,
  "imageUrl"    TEXT,
  "ctaHref"     TEXT NOT NULL DEFAULT '/menu',
  "ctaLabel"    TEXT NOT NULL DEFAULT 'Order now',
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "startsAt"    TIMESTAMP(3),
  "endsAt"      TIMESTAMP(3),
  "updatedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HeroSlide_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HeroSlide_isActive_sortOrder_idx" ON "HeroSlide"("isActive", "sortOrder");
