import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { invalidate } from "@/lib/revalidate";
import { CacheTag } from "@/lib/cache-tags";

/**
 * The public pages whose words the owner edits.
 *
 * Read and update only. There is no create and no delete, and that is the
 * point: a slug is half of a route, so a page invented at runtime is a page
 * that 404s because of a typo nobody can see. Adding one is a seed entry and a
 * route, which is the same ceremony the route needed anyway.
 *
 * The slug is not editable either, for the same reason — renaming it would
 * silently break every link anybody has already shared.
 */
const PAGE_SELECT = {
  id: true,
  slug: true,
  title: true,
  body: true,
  summary: true,
  isPublished: true,
  updatedById: true,
  updatedAt: true,
};

export async function listContentPages() {
  return prisma.contentPage.findMany({ select: PAGE_SELECT, orderBy: { title: "asc" } });
}

export async function getContentPage(id) {
  const page = await prisma.contentPage.findUnique({ where: { id }, select: PAGE_SELECT });
  if (!page) throw ApiError.notFound("Page not found");
  return page;
}

/** One published page, by slug. The storefront's read. */
export async function publishedPage(slug) {
  const page = await prisma.contentPage.findUnique({ where: { slug }, select: PAGE_SELECT });

  // An unpublished page is a 404 rather than an empty one: a page that is not
  // ready should look like it does not exist, not like it is broken.
  if (!page || !page.isPublished) throw ApiError.notFound("Page not found");
  return page;
}

export async function updateContentPage({ id, data, actorId = null }) {
  await getContentPage(id);

  const page = await prisma.contentPage.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
      updatedById: actorId,
    },
    select: PAGE_SELECT,
  });

  // The storefront caches these, so an edit nobody can see until the cache
  // expires is indistinguishable from an edit that did not save.
  invalidate(CacheTag.CONTENT_PAGES);

  return page;
}
