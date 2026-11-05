import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createHeroSlideSchema } from "@/server/validation/hero.schemas";
import { createHeroSlide, listHeroSlides } from "@/server/services/hero.service";
import { CacheTag } from "@/lib/cache-tags";

/** Every slide, live or not — a campaign scheduled for next week has to be visible. */
export const GET = apiHandler({ auth: true, permissions: "hero_slides.read" }, async () =>
  ok(await listHeroSlides()),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "hero_slides.manage",
    body: createHeroSlideSchema,
    rateLimit: RateLimits.write,
    audit: { action: "hero_slide.create", entityType: "HeroSlide" },
    invalidates: [CacheTag.HOME],
  },
  async ({ body, auth }) => created(await createHeroSlide(body, auth.userId)),
);
