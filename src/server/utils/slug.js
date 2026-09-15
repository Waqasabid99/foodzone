import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

/**
 * A slug that is unique within a model, appending -2, -3, ... on collision.
 *
 * The loop closes most of the race, but two requests can still resolve the same
 * free slug simultaneously — the unique index on the column is what actually
 * guarantees correctness. Catch P2002 and retry, or call
 * `generateUniqueSlugWithRetry`.
 *
 * `where` scopes uniqueness to a subset, e.g. menus unique per branch:
 *   generateUniqueSlug({ text: name, model: "menu", where: { branchId } })
 */
export async function generateUniqueSlug({ text, model, excludeId = null, where = {}, client = prisma }) {
  const base = slugify(text);
  if (!base) throw new Error(`Cannot build a slug from "${text}"`);

  const delegate = client[model];
  if (!delegate) throw new Error(`Unknown Prisma model "${model}"`);

  let slug = base;
  let suffix = 2;

  // Bounded so a pathological collision set cannot spin forever.
  while (suffix < 1000) {
    const clash = await delegate.findFirst({
      where: { ...where, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return slug;

    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  // Give up on pretty and guarantee uniqueness.
  return `${base}-${Date.now().toString(36)}`;
}
