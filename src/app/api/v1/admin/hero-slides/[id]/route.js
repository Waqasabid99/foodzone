import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateHeroSlideSchema } from "@/server/validation/hero.schemas";
import { deleteHeroSlide, getHeroSlide, updateHeroSlide } from "@/server/services/hero.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "hero_slides.read", params: idParamSchema },
  async ({ params }) => ok(await getHeroSlide(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "hero_slides.manage",
    params: idParamSchema,
    body: updateHeroSlideSchema,
    rateLimit: RateLimits.write,
    audit: { action: "hero_slide.update", entityType: "HeroSlide" },
    invalidates: [CacheTag.HOME],
  },
  async ({ params, body, auth }) => ok(await updateHeroSlide(params.id, body, auth.userId)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "hero_slides.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "hero_slide.delete", entityType: "HeroSlide" },
    invalidates: [CacheTag.HOME],
  },
  async ({ params }) => ok(await deleteHeroSlide(params.id)),
);
