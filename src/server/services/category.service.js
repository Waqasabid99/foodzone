import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { generateUniqueSlug } from "@/server/utils/slug";

/**
 * Categories: the menu's navigation tree.
 *
 * A category may nest ("Drinks > Hot"), so every write has to defend the tree's
 * two invariants — a category is never its own ancestor, and the tree stays
 * shallow enough to render. Both are cheap to check here and impossible to
 * repair once the data is cyclic: a cycle turns any recursive read into an
 * infinite loop, and it would be introduced by a single careless drag in an
 * admin UI.
 */

/** Deep enough for "Food > Pizza > By the slice", shallow enough to navigate. */
const MAX_DEPTH = 4;

const SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  parentId: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/** Every ancestor of `id`, nearest first. Bounded by MAX_DEPTH + slack. */
async function ancestorsOf(id) {
  const chain = [];
  let current = id;

  for (let hop = 0; current && hop < MAX_DEPTH + 4; hop += 1) {
    const row = await prisma.category.findUnique({ where: { id: current }, select: { parentId: true } });
    if (!row?.parentId) break;
    chain.push(row.parentId);
    current = row.parentId;
  }

  return chain;
}

/** How many levels of children hang below `id`. */
async function depthBelow(id) {
  let ids = [id];
  let depth = 0;

  while (ids.length && depth < MAX_DEPTH + 2) {
    const children = await prisma.category.findMany({
      where: { parentId: { in: ids } },
      select: { id: true },
    });
    if (!children.length) break;
    ids = children.map((row) => row.id);
    depth += 1;
  }

  return depth;
}

async function assertParentIsValid({ parentId, categoryId = null }) {
  if (!parentId) return;

  const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true } });
  if (!parent) throw ApiError.validation("Parent category not found", { parentId: ["No such category"] });

  if (categoryId) {
    if (parentId === categoryId) {
      throw ApiError.validation("A category cannot be its own parent", { parentId: ["Choose a different parent"] });
    }
    // Moving a category under one of its own descendants would orphan the
    // whole subtree into a cycle.
    const ancestors = await ancestorsOf(parentId);
    if (ancestors.includes(categoryId)) {
      throw ApiError.validation("A category cannot be moved beneath itself", {
        parentId: ["That category is already inside this one"],
      });
    }
  }

  const parentDepth = (await ancestorsOf(parentId)).length + 1;
  const subtreeDepth = categoryId ? await depthBelow(categoryId) : 0;
  if (parentDepth + subtreeDepth + 1 > MAX_DEPTH) {
    throw ApiError.validation(`Categories may nest at most ${MAX_DEPTH} levels deep`, {
      parentId: ["That would make the tree too deep"],
    });
  }
}

/** Flat rows to a nested tree, preserving sort order at every level. */
export function buildTree(rows) {
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots = [];

  for (const row of byId.values()) {
    const parent = row.parentId ? byId.get(row.parentId) : null;
    // A child whose parent was filtered out (inactive, say) is surfaced at the
    // root rather than silently dropped.
    if (parent) parent.children.push(row);
    else roots.push(row);
  }

  return roots;
}

export async function listCategories({ search, isActive, parentId, tree = false, includeCounts = false } = {}) {
  const rows = await prisma.category.findMany({
    where: {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(parentId ? { parentId } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: {
      ...SELECT,
      ...(includeCounts
        ? { _count: { select: { products: { where: { deletedAt: null, isActive: true } } } } }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const items = rows.map(({ _count, ...row }) => ({
    ...row,
    ...(includeCounts ? { productCount: _count.products } : {}),
  }));

  return tree ? buildTree(items) : items;
}

export async function getCategory(idOrSlug) {
  const category = await prisma.category.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      ...SELECT,
      children: { select: SELECT, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      _count: { select: { products: { where: { deletedAt: null } } } },
    },
  });
  if (!category) throw ApiError.notFound("Category not found");

  const { _count, ...rest } = category;
  return { ...rest, productCount: _count.products };
}

export async function createCategory(data) {
  await assertParentIsValid({ parentId: data.parentId ?? null });

  const slug = await generateUniqueSlug({ text: data.slug ?? data.name, model: "category" });

  return prisma.category.create({
    data: { ...data, slug, parentId: data.parentId ?? null },
    select: SELECT,
  });
}

export async function updateCategory(id, data) {
  const existing = await prisma.category.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!existing) throw ApiError.notFound("Category not found");

  if (data.parentId !== undefined) {
    await assertParentIsValid({ parentId: data.parentId ?? null, categoryId: id });
  }

  const slug = data.slug ? await generateUniqueSlug({ text: data.slug, model: "category", excludeId: id }) : undefined;

  return prisma.category.update({
    where: { id },
    data: { ...data, ...(slug ? { slug } : {}) },
    select: SELECT,
  });
}

/**
 * Deleting is refused while anything still points at the category.
 *
 * Cascading would take the products with it, and a category is deleted by
 * accident far more often than a menu's worth of products is. Deactivate to
 * hide one instead.
 */
export async function deleteCategory(id) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { id: true, _count: { select: { products: true, children: true } } },
  });
  if (!category) throw ApiError.notFound("Category not found");

  if (category._count.products > 0) {
    throw ApiError.conflict(
      `This category still holds ${category._count.products} product(s). Move them first, or deactivate the category instead.`,
    );
  }
  if (category._count.children > 0) {
    throw ApiError.conflict("Delete or move the sub-categories first");
  }

  await prisma.category.delete({ where: { id } });
  return { deleted: true, id };
}

/** Bulk sort update — what a drag-and-drop admin screen sends on drop. */
export async function reorderCategories(items) {
  const ids = items.map((item) => item.id);
  const found = await prisma.category.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw ApiError.validation("One or more categories do not exist");

  await prisma.$transaction(
    items.map((item) => prisma.category.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
  );

  return { updated: items.length };
}
