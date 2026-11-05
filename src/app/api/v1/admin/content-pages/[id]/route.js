import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateContentPageSchema } from "@/server/validation/content.schemas";
import { getContentPage, updateContentPage } from "@/server/services/content-page.service";
import { CacheTag } from "@/lib/cache-tags";

export const GET = apiHandler(
  { auth: true, permissions: "content_pages.read", params: idParamSchema },
  async ({ params }) => ok(await getContentPage(params.id)),
);

/**
 * No DELETE, and no way to change the slug.
 *
 * Renaming a slug silently breaks every link anybody has already shared — from
 * a printed menu, an email footer, a search result — and the page it breaks is
 * usually the one somebody is trying to read because something went wrong.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "content_pages.update",
    params: idParamSchema,
    body: updateContentPageSchema,
    rateLimit: RateLimits.write,
    audit: { action: "content_page.update", entityType: "ContentPage" },
    invalidates: [CacheTag.CONTENT_PAGES],
  },
  async ({ params, body, auth }) =>
    ok(await updateContentPage({ id: params.id, data: body, actorId: auth.userId })),
);
