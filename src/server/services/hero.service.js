import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { invalidate } from "@/lib/revalidate";
import { CacheTag } from "@/lib/cache-tags";

/**
 * The home page's hero banners.
 *
 * Two different reads, and the difference matters. The dashboard sees every
 * slide including the ones that are off or out of their window — otherwise a
 * campaign scheduled for next week is invisible to the person who scheduled
 * it. The storefront sees only what is live right now.
 */
const SELECT = {
  id: true,
  headline: true,
  subtext: true,
  imageUrl: true,
  focalPoint: true,
  ctaHref: true,
  ctaLabel: true,
  sortOrder: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  updatedAt: true,
};

/** Lowest `sortOrder` first, then oldest — a total order, so it never wobbles. */
const ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }];

export async function listHeroSlides() {
  return prisma.heroSlide.findMany({ select: SELECT, orderBy: ORDER });
}

export async function getHeroSlide(id) {
  const slide = await prisma.heroSlide.findUnique({ where: { id }, select: SELECT });
  if (!slide) throw ApiError.notFound("Slide not found");
  return slide;
}

/**
 * What a visitor should see, right now.
 *
 * The window is compared against the request time rather than filtered in SQL
 * against `now()` for a reason worth keeping: this read is cached, so "now" is
 * whenever the cache entry was built. The home page revalidates every five
 * minutes, which is the real resolution of a campaign schedule here — a slide
 * set to start at nine o'clock appears by five past. Anything finer would mean
 * giving up the cache, and nobody schedules a banner to the second.
 */
export async function liveHeroSlides(now = new Date()) {
  const slides = await prisma.heroSlide.findMany({
    where: { isActive: true },
    select: SELECT,
    orderBy: ORDER,
  });

  return slides.filter(
    (slide) => (!slide.startsAt || slide.startsAt <= now) && (!slide.endsAt || slide.endsAt > now),
  );
}

export async function createHeroSlide(data, actorId = null) {
  const slide = await prisma.heroSlide.create({
    data: { ...data, updatedById: actorId },
    select: SELECT,
  });
  invalidate(CacheTag.HOME);
  return slide;
}

export async function updateHeroSlide(id, data, actorId = null) {
  await getHeroSlide(id);
  const slide = await prisma.heroSlide.update({
    where: { id },
    data: { ...data, updatedById: actorId },
    select: SELECT,
  });
  invalidate(CacheTag.HOME);
  return slide;
}

export async function deleteHeroSlide(id) {
  await getHeroSlide(id);
  await prisma.heroSlide.delete({ where: { id } });
  invalidate(CacheTag.HOME);
  return { id, deleted: true };
}
