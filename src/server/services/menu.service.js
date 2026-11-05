import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess, cursorArgs, toPage } from "@/lib/api";
import { generateUniqueSlug } from "@/server/utils/slug";
import { withTransaction } from "@/server/utils/db";
import { zonedNow } from "@/server/services/branch.service";

/**
 * Menus: what a branch actually sells, on which channel, at what time, for how
 * much.
 *
 * Products are global; a menu is the branch-scoped decision to offer one. That
 * separation is what makes a lunch menu, delivery pricing and a QR-only menu
 * expressible without duplicating the catalog.
 *
 * A `MenuItem` is always a **(product, variant)** pair, never a bare product.
 * That is a deliberate choice: it lets a branch price a large pizza differently
 * on delivery, and 86 only the large one when the big trays run out. It also
 * sidesteps a real trap — the schema's `@@unique([menuId, productId, variantId])`
 * cannot stop duplicates when `variantId` is NULL, because Postgres treats
 * NULLs in a unique index as distinct. Always writing the variant makes the
 * constraint real.
 *
 * Time windows use minutes from midnight in the branch's own timezone, matching
 * `BranchHour`, with an end past 1440 for a window running into tomorrow.
 */

const MENU_SELECT = {
  id: true,
  branchId: true,
  name: true,
  slug: true,
  type: true,
  description: true,
  activeFrom: true,
  activeTo: true,
  startMinute: true,
  endMinute: true,
  daysOfWeek: true,
  isActive: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
};

const SECTION_SELECT = {
  id: true,
  menuId: true,
  name: true,
  description: true,
  imageUrl: true,
  sortOrder: true,
  isActive: true,
};

const ITEM_SELECT = {
  id: true,
  menuId: true,
  sectionId: true,
  productId: true,
  variantId: true,
  priceOverride: true,
  isAvailable: true,
  unavailableUntil: true,
  isRecommended: true,
  sortOrder: true,
};

// --- availability & scheduling (pure, unit-tested) --------------------------

/**
 * Is a 86'd item back?
 *
 * `unavailableUntil` is honoured at read time rather than relying on a job to
 * clear it. A cron that has not run yet must never keep an item hidden past its
 * own deadline — the nightly sweep is tidy-up, not the mechanism.
 */
export function isItemAvailable(item, at = new Date()) {
  if (item.unavailableUntil) return item.unavailableUntil <= at;
  return item.isAvailable;
}

/** Does a menu's schedule cover this instant, in the branch's local time? */
export function menuMatchesAt(menu, { dayOfWeek, minutes, at = new Date() }) {
  if (!menu.isActive) return false;
  if (menu.activeFrom && at < menu.activeFrom) return false;
  if (menu.activeTo && at > menu.activeTo) return false;

  const days = menu.daysOfWeek ?? [];
  const hasTimeWindow = menu.startMinute != null && menu.endMinute != null;

  // Days without a time window still restrict the menu: "weekend brunch, all
  // day Saturday and Sunday".
  if (days.length && !hasTimeWindow) return days.includes(dayOfWeek);
  if (!hasTimeWindow) return true;

  const runsToday =
    (!days.length || days.includes(dayOfWeek)) && minutes >= menu.startMinute && minutes < menu.endMinute;
  if (runsToday) return true;

  // Yesterday's window spilling past midnight: 01:00 falls inside 20:00–02:00.
  const yesterday = (dayOfWeek + 6) % 7;
  return (
    menu.endMinute > 1440 &&
    (!days.length || days.includes(yesterday)) &&
    minutes + 1440 >= menu.startMinute &&
    minutes + 1440 < menu.endMinute
  );
}

/**
 * Picks one menu when several match.
 *
 * More specific wins: a menu limited to lunchtime beats an all-day one, because
 * whoever scheduled it meant it to take over during those hours. `isDefault`
 * only breaks ties between equally specific menus — it is the fallback, not a
 * trump card.
 */
export function pickActiveMenu(menus, context) {
  const matching = menus.filter((menu) => menuMatchesAt(menu, context));
  if (!matching.length) return null;

  const specificity = (menu) =>
    (menu.startMinute != null ? 4 : 0) +
    (menu.daysOfWeek?.length ? 2 : 0) +
    (menu.activeFrom || menu.activeTo ? 1 : 0);

  return matching.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      Number(b.isDefault) - Number(a.isDefault) ||
      b.updatedAt - a.updatedAt,
  )[0];
}

// --- menus ------------------------------------------------------------------

async function assertBranchExists(branchId) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, timezone: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });
  return branch;
}

/**
 * The branch a menu belongs to.
 *
 * Sub-resource routes (`/admin/menus/{id}/items`) only carry the menu id, so
 * the branch a permission is measured against has to be read before the check
 * can happen. `apiHandler` cannot do that itself — it resolves the branch from
 * the request alone — so those routes call this and then `assertBranchAccess`.
 */
export async function menuBranchId(menuId) {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { branchId: true } });
  if (!menu) throw ApiError.notFound("Menu not found");
  return menu.branchId;
}

/** Menu id in, branch permission check done, branch id out. */
export async function assertMenuAccess(principal, menuId, permissionKey) {
  const branchId = await menuBranchId(menuId);
  assertBranchAccess(principal, branchId, permissionKey);
  return branchId;
}

/**
 * `scope` is the `branchScope` of whoever is asking. Without it a manager
 * scoped to one outlet who omits `branchId` holds `menus.read` "somewhere" and
 * is handed every branch's menus.
 */
function scopeWhere(scope) {
  if (!scope) return {};
  if (scope.all) return scope.except?.length ? { branchId: { notIn: scope.except } } : {};
  return { branchId: { in: scope.ids } };
}

export async function listMenus({ branchId, type, isActive, limit = 20, cursor, scope = null } = {}) {
  const rows = await prisma.menu.findMany({
    where: {
      AND: [scopeWhere(scope), branchId ? { branchId } : {}],
      ...(type ? { type } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
    select: { ...MENU_SELECT, _count: { select: { items: true, sections: true } } },
    orderBy: [{ branchId: "asc" }, { type: "asc" }, { name: "asc" }, { id: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...menu }) => ({
      ...menu,
      itemCount: _count.items,
      sectionCount: _count.sections,
    })),
  };
}

export async function getMenu(id) {
  const menu = await prisma.menu.findUnique({
    where: { id },
    select: {
      ...MENU_SELECT,
      branch: { select: { id: true, code: true, name: true, timezone: true } },
      sections: { select: SECTION_SELECT, orderBy: { sortOrder: "asc" } },
      _count: { select: { items: true } },
    },
  });
  if (!menu) throw ApiError.notFound("Menu not found");

  const { _count, ...rest } = menu;
  return { ...rest, itemCount: _count.items };
}

/**
 * Only one default per (branch, type): the default is the answer to "what do we
 * show when nothing else matches", and that question has exactly one answer.
 */
async function clearOtherDefaults({ tx, branchId, type, exceptId = null }) {
  await tx.menu.updateMany({
    where: { branchId, type, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createMenu(data) {
  await assertBranchExists(data.branchId);

  const slug = await generateUniqueSlug({
    text: data.slug ?? data.name,
    model: "menu",
    where: { branchId: data.branchId },
  });

  return withTransaction(async (tx) => {
    if (data.isDefault) await clearOtherDefaults({ tx, branchId: data.branchId, type: data.type });

    /*
     * On by default — but only when there is nothing to displace.
     *
     * A menu created switched off is the right answer for a shop that is
     * already trading: a new, empty menu going live can win the pick against
     * the one customers are ordering from, and replace it with nothing. It is
     * the wrong answer for the first menu a branch ever has, which is the
     * setup case: the menu is created, the storefront reports "no menu running
     * right now", and the only clue is a notice on the public site.
     *
     * So the rule is about displacement, not novelty: if no other menu of this
     * type is live at this branch, there is nothing to break and it goes live.
     * An explicit `isActive` always wins — the form sends one.
     */
    const displaces = await tx.menu.count({
      where: { branchId: data.branchId, type: data.type, isActive: true },
    });

    return tx.menu.create({
      data: { ...data, isActive: data.isActive ?? displaces === 0, slug },
      select: MENU_SELECT,
    });
  });
}

export async function updateMenu(id, data) {
  const menu = await prisma.menu.findUnique({
    where: { id },
    select: { id: true, branchId: true, type: true, isDefault: true, startMinute: true, endMinute: true },
  });
  if (!menu) throw ApiError.notFound("Menu not found");

  // The schema-level refinements only see the fields present in a PATCH, so
  // check the merged result too: clearing just `startMinute` would otherwise
  // leave a half-defined window.
  const merged = { ...menu, ...data };
  if ((merged.startMinute == null) !== (merged.endMinute == null)) {
    throw ApiError.validation("A time window needs both a start and an end", {
      endMinute: ["Set both startMinute and endMinute, or clear both"],
    });
  }
  if (merged.startMinute != null && merged.endMinute <= merged.startMinute) {
    throw ApiError.validation("The window must end after it starts", {
      endMinute: ["Use minutes past 1440 for a window that runs past midnight"],
    });
  }

  const slug = data.slug
    ? await generateUniqueSlug({ text: data.slug, model: "menu", excludeId: id, where: { branchId: menu.branchId } })
    : undefined;

  return withTransaction(async (tx) => {
    // A default menu moved to another channel stays the default there, so the
    // channel it lands in must give up its own — otherwise it has two.
    const staysDefault = data.isDefault ?? menu.isDefault;
    if (staysDefault && (data.isDefault || (data.type && data.type !== menu.type))) {
      await clearOtherDefaults({ tx, branchId: menu.branchId, type: data.type ?? menu.type, exceptId: id });
    }

    return tx.menu.update({ where: { id }, data: { ...data, ...(slug ? { slug } : {}) }, select: MENU_SELECT });
  });
}

export async function deleteMenu(id) {
  const menu = await prisma.menu.findUnique({
    where: { id },
    select: { id: true, _count: { select: { qrCodes: true } } },
  });
  if (!menu) throw ApiError.notFound("Menu not found");

  // Printed QR codes point here. Deleting would send every scanned table to a
  // dead link, so the codes have to be repointed first.
  if (menu._count.qrCodes > 0) {
    throw ApiError.conflict(
      `${menu._count.qrCodes} QR code(s) point at this menu. Repoint them before deleting it.`,
    );
  }

  // Sections and items cascade with the menu.
  await prisma.menu.delete({ where: { id } });
  return { deleted: true, id };
}

/**
 * Copies a menu, with its sections and items, to another branch or channel.
 *
 * Setting up a second branch, or a delivery menu priced above dine-in,
 * otherwise means re-entering every line by hand — which is both tedious and
 * the point at which two branches quietly stop selling the same thing.
 *
 * Three decisions are worth stating, because each is a deliberate refusal to
 * copy something:
 *
 *   * **The clone is inactive unless asked.** A menu that goes live at another
 *     branch the instant it is created is the opposite of what cloning is for:
 *     you clone in order to adjust prices before anyone can order from it.
 *   * **The 86 state is not copied.** `isAvailable` and `unavailableUntil` say
 *     that *this* branch ran out of something *today*. Carrying that to another
 *     branch would mark items sold out that are sitting in its fridge.
 *   * **`isDefault` is not inherited.** Two default menus on one branch and
 *     channel is a resolution ambiguity; it is granted only when asked for, and
 *     then it displaces the existing default the same way `createMenu` does.
 *
 * Products and variants are global, so nothing about the catalog has to be
 * copied alongside — the clone references exactly the same sellable units.
 */
export async function cloneMenu(
  id,
  { branchId = null, type = null, name = null, slug = null, isActive = false, isDefault = false, includeItems = true },
) {
  const source = await prisma.menu.findUnique({
    where: { id },
    select: {
      ...MENU_SELECT,
      sections: { select: SECTION_SELECT, orderBy: { sortOrder: "asc" } },
      items: {
        select: {
          sectionId: true,
          productId: true,
          variantId: true,
          priceOverride: true,
          isRecommended: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!source) throw ApiError.notFound("Menu not found");

  const targetBranchId = branchId ?? source.branchId;
  const targetType = type ?? source.type;

  await assertBranchExists(targetBranchId);

  // Cloning a menu onto itself — same branch, same channel — is almost always a
  // misclick rather than an intent to keep two identical menus, so it needs a
  // name that says which is which.
  const sameSlot = targetBranchId === source.branchId && targetType === source.type;
  const targetName = name ?? (sameSlot ? `${source.name} (copy)` : source.name);

  const targetSlug = await generateUniqueSlug({
    text: slug ?? targetName,
    model: "menu",
    where: { branchId: targetBranchId },
  });

  return withTransaction(async (tx) => {
    if (isDefault) await clearOtherDefaults({ tx, branchId: targetBranchId, type: targetType });

    const menu = await tx.menu.create({
      data: {
        branchId: targetBranchId,
        name: targetName,
        slug: targetSlug,
        type: targetType,
        description: source.description,
        activeFrom: source.activeFrom,
        activeTo: source.activeTo,
        startMinute: source.startMinute,
        endMinute: source.endMinute,
        daysOfWeek: source.daysOfWeek,
        isActive,
        isDefault,
      },
      select: MENU_SELECT,
    });

    // Sections are recreated first so items can be pointed at the new ids.
    const sectionIdBySource = new Map();
    for (const section of source.sections) {
      const created = await tx.menuSection.create({
        data: {
          menuId: menu.id,
          name: section.name,
          description: section.description,
          imageUrl: section.imageUrl,
          sortOrder: section.sortOrder,
          isActive: section.isActive,
        },
        select: { id: true },
      });
      sectionIdBySource.set(section.id, created.id);
    }

    let itemCount = 0;
    if (includeItems && source.items.length) {
      const result = await tx.menuItem.createMany({
        data: source.items.map((item) => ({
          menuId: menu.id,
          sectionId: item.sectionId ? (sectionIdBySource.get(item.sectionId) ?? null) : null,
          productId: item.productId,
          variantId: item.variantId,
          priceOverride: item.priceOverride,
          isRecommended: item.isRecommended,
          sortOrder: item.sortOrder,
        })),
      });
      itemCount = result.count;
    }

    return { ...menu, clonedFrom: source.id, sectionCount: sectionIdBySource.size, itemCount };
  });
}

// --- sections ---------------------------------------------------------------

export async function listSections(menuId) {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { id: true } });
  if (!menu) throw ApiError.notFound("Menu not found");

  return prisma.menuSection.findMany({ where: { menuId }, select: SECTION_SELECT, orderBy: { sortOrder: "asc" } });
}

export async function createSection(menuId, data) {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { id: true } });
  if (!menu) throw ApiError.notFound("Menu not found");

  const count = await prisma.menuSection.count({ where: { menuId } });
  return prisma.menuSection.create({
    data: { ...data, menuId, sortOrder: data.sortOrder ?? count },
    select: SECTION_SELECT,
  });
}

export async function updateSection({ menuId, sectionId, data }) {
  const section = await prisma.menuSection.findFirst({ where: { id: sectionId, menuId }, select: { id: true } });
  if (!section) throw ApiError.notFound("Menu section not found");

  return prisma.menuSection.update({ where: { id: sectionId }, data, select: SECTION_SELECT });
}

/** Items survive; they simply return to the menu's unsectioned pool. */
export async function deleteSection({ menuId, sectionId }) {
  const section = await prisma.menuSection.findFirst({ where: { id: sectionId, menuId }, select: { id: true } });
  if (!section) throw ApiError.notFound("Menu section not found");

  await prisma.menuSection.delete({ where: { id: sectionId } });
  return { deleted: true, id: sectionId };
}

export async function reorderSections({ menuId, items }) {
  const ids = items.map((item) => item.id);
  const found = await prisma.menuSection.count({ where: { menuId, id: { in: ids } } });
  if (found !== ids.length) throw ApiError.validation("One or more sections do not belong to this menu");

  await prisma.$transaction(
    items.map((item) => prisma.menuSection.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
  );

  return { updated: items.length };
}

// --- items ------------------------------------------------------------------

const ITEM_WITH_PRODUCT = {
  ...ITEM_SELECT,
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      type: true,
      isActive: true,
      deletedAt: true,
      dietary: true,
      spiceLevel: true,
      prepTimeMinutes: true,
      categoryId: true,
      category: { select: { id: true, name: true, slug: true } },
    },
  },
  variant: { select: { id: true, name: true, price: true, compareAtPrice: true, isActive: true, sortOrder: true } },
  section: { select: { id: true, name: true, sortOrder: true } },
};

/** The price a customer pays: the menu's override if there is one, else the variant's. */
function effectivePrice(item) {
  return Number(item.priceOverride ?? item.variant.price);
}

function shapeItem(item, at = new Date()) {
  return {
    ...item,
    price: effectivePrice(item),
    basePrice: Number(item.variant.price),
    isPriceOverridden: item.priceOverride != null,
    available: isItemAvailable(item, at) && item.variant.isActive && item.product.isActive && !item.product.deletedAt,
  };
}

export async function listMenuItems({ menuId, sectionId, isAvailable, search, limit = 50, cursor }) {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { id: true } });
  if (!menu) throw ApiError.notFound("Menu not found");

  const rows = await prisma.menuItem.findMany({
    where: {
      menuId,
      ...(sectionId ? { sectionId } : {}),
      ...(isAvailable !== undefined ? { isAvailable } : {}),
      ...(search ? { product: { name: { contains: search, mode: "insensitive" } } } : {}),
    },
    select: ITEM_WITH_PRODUCT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  const at = new Date();
  return { ...page, items: page.items.map((item) => shapeItem(item, at)) };
}

/**
 * Every row of a menu, for the screen that edits it.
 *
 * Unpaginated because the editor arranges the whole menu at once — moving a
 * product means knowing where everything else is. The cap is far above any
 * real menu (one row per size) and exists so a runaway import cannot take the
 * page down with it; `truncated` says when it was hit.
 */
export async function listAllMenuItems(menuId, { max = 5000 } = {}) {
  const rows = await prisma.menuItem.findMany({
    where: { menuId },
    select: ITEM_WITH_PRODUCT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: max + 1,
  });
  return { items: rows.slice(0, max), truncated: rows.length > max };
}

/**
 * Adds a product to a menu.
 *
 * With no `variantId` every active variant is added, one row each — so "add the
 * pizza" puts small, medium and large on the menu, each independently priceable
 * and 86-able. Variants already on the menu are skipped rather than erroring,
 * which makes re-running the call after adding a new size do the right thing.
 */
export async function addMenuItem(menuId, data) {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { id: true } });
  if (!menu) throw ApiError.notFound("Menu not found");

  const product = await prisma.product.findFirst({
    where: { id: data.productId, deletedAt: null },
    select: {
      id: true,
      variants: { where: { isActive: true }, select: { id: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!product) throw ApiError.validation("Product not found", { productId: ["No such product"] });

  let variantIds;
  if (data.variantId) {
    if (!product.variants.some((variant) => variant.id === data.variantId)) {
      throw ApiError.validation("That variant does not belong to the product, or is inactive", {
        variantId: ["Pick an active variant of this product"],
      });
    }
    variantIds = [data.variantId];
  } else {
    if (!product.variants.length) {
      throw ApiError.validation("That product has no active variant to put on a menu", {
        productId: ["Activate a variant first"],
      });
    }
    variantIds = product.variants.map((variant) => variant.id);
  }

  if (data.sectionId) {
    const section = await prisma.menuSection.findFirst({
      where: { id: data.sectionId, menuId },
      select: { id: true },
    });
    if (!section) {
      throw ApiError.validation("That section does not belong to this menu", { sectionId: ["No such section"] });
    }
  }

  const existing = await prisma.menuItem.findMany({
    where: { menuId, productId: product.id, variantId: { in: variantIds } },
    select: { variantId: true },
  });
  const already = new Set(existing.map((row) => row.variantId));
  const toCreate = variantIds.filter((variantId) => !already.has(variantId));

  if (!toCreate.length) throw ApiError.conflict("Those variants are already on this menu");

  const count = await prisma.menuItem.count({ where: { menuId } });
  await prisma.menuItem.createMany({
    data: toCreate.map((variantId, index) => ({
      menuId,
      productId: product.id,
      variantId,
      sectionId: data.sectionId ?? null,
      priceOverride: data.priceOverride ?? null,
      isRecommended: data.isRecommended ?? false,
      isAvailable: data.isAvailable ?? true,
      sortOrder: (data.sortOrder ?? count) + index,
    })),
    skipDuplicates: true,
  });

  const created = await prisma.menuItem.findMany({
    where: { menuId, productId: product.id, variantId: { in: toCreate } },
    select: ITEM_WITH_PRODUCT,
  });

  return created.map((item) => shapeItem(item));
}

export async function updateMenuItem({ menuId, itemId, data }) {
  const item = await prisma.menuItem.findFirst({ where: { id: itemId, menuId }, select: { id: true } });
  if (!item) throw ApiError.notFound("Menu item not found");

  if (data.sectionId) {
    const section = await prisma.menuSection.findFirst({
      where: { id: data.sectionId, menuId },
      select: { id: true },
    });
    if (!section) {
      throw ApiError.validation("That section does not belong to this menu", { sectionId: ["No such section"] });
    }
  }

  const updated = await prisma.menuItem.update({ where: { id: itemId }, data, select: ITEM_WITH_PRODUCT });
  return shapeItem(updated);
}

export async function removeMenuItem({ menuId, itemId }) {
  const item = await prisma.menuItem.findFirst({ where: { id: itemId, menuId }, select: { id: true } });
  if (!item) throw ApiError.notFound("Menu item not found");

  await prisma.menuItem.delete({ where: { id: itemId } });
  return { deleted: true, id: itemId };
}

// --- whole products on a menu -------------------------------------------------

/**
 * A menu stores one row per size, but people arrange a menu by product: "put
 * the burger under Mains", "recommend the pizza". Doing that row by row from a
 * client is several requests that can half-succeed, so these operate on every
 * row of the product at once.
 */
async function productRows(menuId, productId) {
  const rows = await prisma.menuItem.findMany({ where: { menuId, productId }, select: { id: true } });
  if (!rows.length) throw ApiError.notFound("That product is not on this menu");
  return rows;
}

async function assertSectionOnMenu(menuId, sectionId) {
  if (!sectionId) return;
  const section = await prisma.menuSection.findFirst({ where: { id: sectionId, menuId }, select: { id: true } });
  if (!section) {
    throw ApiError.validation("That section does not belong to this menu", { sectionId: ["No such section"] });
  }
}

async function nextSortOrder(menuId) {
  const last = await prisma.menuItem.aggregate({ where: { menuId }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? -1) + 1;
}

/**
 * Adds several products at once, every active size of each.
 *
 * Building a menu one product at a time is what makes a new branch take an
 * afternoon. Products already fully on the menu, and ones with no active size,
 * are reported back as skipped rather than failing the whole request — the
 * rest of the selection is still what was asked for.
 */
export async function addMenuProducts(menuId, { productIds, sectionId = null }) {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: { id: true } });
  if (!menu) throw ApiError.notFound("Menu not found");
  await assertSectionOnMenu(menuId, sectionId);

  const unique = [...new Set(productIds)];
  const products = await prisma.product.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: {
      id: true,
      name: true,
      variants: { where: { isActive: true }, select: { id: true }, orderBy: [{ sortOrder: "asc" }, { price: "asc" }] },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const existing = await prisma.menuItem.findMany({
    where: { menuId, productId: { in: unique } },
    select: { variantId: true },
  });
  const onMenu = new Set(existing.map((row) => row.variantId));

  const skipped = [];
  const rows = [];
  let sortOrder = await nextSortOrder(menuId);

  // Kept in the order they were picked, which is the order they appear in.
  for (const productId of unique) {
    const product = byId.get(productId);
    if (!product) {
      skipped.push({ productId, name: null, reason: "NOT_FOUND" });
      continue;
    }
    if (!product.variants.length) {
      skipped.push({ productId, name: product.name, reason: "NO_ACTIVE_SIZE" });
      continue;
    }
    const missing = product.variants.filter((variant) => !onMenu.has(variant.id));
    if (!missing.length) {
      skipped.push({ productId, name: product.name, reason: "ALREADY_ON_MENU" });
      continue;
    }
    for (const variant of missing) {
      rows.push({ menuId, productId, variantId: variant.id, sectionId, sortOrder });
    }
    sortOrder += 1;
  }

  const result = rows.length ? await prisma.menuItem.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  const addedProducts = new Set(rows.map((row) => row.productId)).size;

  return { addedProducts, addedItems: result.count, skipped };
}

export async function updateMenuProduct({ menuId, productId, data }) {
  await productRows(menuId, productId);
  await assertSectionOnMenu(menuId, data.sectionId);

  const changes = {};
  if (data.isRecommended !== undefined) changes.isRecommended = data.isRecommended;
  if (data.sectionId !== undefined) {
    changes.sectionId = data.sectionId;
    // Moving to another section lands it at the end there, which is where
    // someone watching the list expects to find it.
    changes.sortOrder = await nextSortOrder(menuId);
  }

  const result = await prisma.menuItem.updateMany({ where: { menuId, productId }, data: changes });
  return { updated: result.count };
}

export async function removeMenuProduct({ menuId, productId }) {
  await productRows(menuId, productId);
  const result = await prisma.menuItem.deleteMany({ where: { menuId, productId } });
  return { deleted: result.count, productId };
}

/**
 * Puts products in the given order. The list must be the menu's complete set:
 * a partial order leaves the omitted products colliding with the new
 * positions, and the resulting order would depend on row ids.
 */
export async function reorderMenuProducts({ menuId, productIds }) {
  const rows = await prisma.menuItem.findMany({ where: { menuId }, select: { productId: true }, distinct: ["productId"] });
  const onMenu = new Set(rows.map((row) => row.productId));
  const given = new Set(productIds);

  if (given.size !== productIds.length || given.size !== onMenu.size || [...given].some((id) => !onMenu.has(id))) {
    throw ApiError.conflict("The menu changed while you were arranging it. Reload and try again.");
  }

  await prisma.$transaction(
    productIds.map((productId, position) =>
      prisma.menuItem.updateMany({ where: { menuId, productId }, data: { sortOrder: position } }),
    ),
  );
  return { updated: productIds.length };
}

/** Sold out for every size at once — how a kitchen actually runs out of something. */
export async function setMenuProductAvailability({ menuId, productId, isAvailable, until = null }) {
  await productRows(menuId, productId);
  assertAvailabilityInput({ isAvailable, until });

  const result = await prisma.menuItem.updateMany({
    where: { menuId, productId },
    data: { isAvailable, unavailableUntil: isAvailable ? null : until },
  });
  return { updated: result.count };
}

function assertAvailabilityInput({ isAvailable, until }) {
  if (isAvailable && until) {
    throw ApiError.validation("An availability deadline only applies when marking an item unavailable", {
      until: ["Omit `until` when marking an item available"],
    });
  }
  if (until && until <= new Date()) {
    throw ApiError.validation("That deadline is already in the past", { until: ["Choose a future time"] });
  }
}

/**
 * The 86 switch — the single most-used endpoint in a live service.
 *
 * Marking unavailable with an `until` is a timed 86 ("back tomorrow"); without
 * one it stays off until someone turns it back on. Turning it back on clears
 * the deadline, so the two controls can never disagree.
 */
export async function setMenuItemAvailability({ menuId, itemId, isAvailable, until = null }) {
  const item = await prisma.menuItem.findFirst({ where: { id: itemId, menuId }, select: { id: true } });
  if (!item) throw ApiError.notFound("Menu item not found");

  assertAvailabilityInput({ isAvailable, until });

  const updated = await prisma.menuItem.update({
    where: { id: itemId },
    data: { isAvailable, unavailableUntil: isAvailable ? null : until },
    select: ITEM_WITH_PRODUCT,
  });

  return shapeItem(updated);
}

/**
 * Housekeeping: turns timed 86s back on once their deadline passes.
 *
 * Reads already treat an expired deadline as available, so this only keeps the
 * stored state honest for anything reading the column directly (reports, the
 * POS's local cache).
 */
export async function clearExpiredAvailability(now = new Date()) {
  const result = await prisma.menuItem.updateMany({
    where: { isAvailable: false, unavailableUntil: { not: null, lte: now } },
    data: { isAvailable: true, unavailableUntil: null },
  });

  return result.count;
}

// --- the storefront read model ----------------------------------------------

/** The menu channel an order type is served from. */
export const ORDER_TYPE_MENU = { DELIVERY: "DELIVERY", PICKUP: "TAKEAWAY", DINE_IN: "DINE_IN" };

/**
 * The menu a customer ordering this way sees — and is charged from.
 *
 * The single answer for every reader. The menu page, the product page and the
 * cart each resolved this separately once, and they disagreed: the pages
 * picked from every channel at once while checkout picked by order type, so a
 * branch with its own delivery prices showed one price and charged another.
 *
 * Delivery and pickup fall back to the dine-in menu when their own channel has
 * nothing showing: most restaurants publish one menu, and refusing to sell for
 * want of a second would be worse than selling at dine-in prices.
 */
export async function getOrderMenu({ branchIdOrCode, orderType, at = new Date(), includeUnavailable = false }) {
  const type = ORDER_TYPE_MENU[orderType] ?? "DINE_IN";
  const resolved = await getBranchMenu({ branchIdOrCode, type, at, includeUnavailable });
  if (resolved.menu || type === "DINE_IN") return resolved;

  const fallback = await getBranchMenu({ branchIdOrCode, type: "DINE_IN", at, includeUnavailable });
  // With nothing to fall back to, the reason worth reporting is the channel's own.
  return fallback.menu ? fallback : resolved;
}

/**
 * The menu a customer sees: one query per menu, assembled into sections.
 *
 * This is the hottest read in the system — every app launch and every QR scan
 * hits it — so it fetches the items in a single query with their product and
 * variant, and groups in memory rather than issuing a query per section.
 */
export async function getBranchMenu({
  branchIdOrCode,
  type = null,
  menuSlug = null,
  at = new Date(),
  includeUnavailable = false,
}) {
  const branch = await prisma.branch.findFirst({
    where: { OR: [{ id: branchIdOrCode }, { code: branchIdOrCode }], isActive: true },
    select: { id: true, code: true, name: true, timezone: true, currency: true },
  });
  if (!branch) throw ApiError.notFound("Branch not found");

  const candidates = await prisma.menu.findMany({
    where: { branchId: branch.id, isActive: true, ...(type ? { type } : {}), ...(menuSlug ? { slug: menuSlug } : {}) },
    select: MENU_SELECT,
  });

  const { dayOfWeek, minutes } = zonedNow(branch.timezone, at);
  // An explicitly requested menu is shown even outside its window — that is
  // what "preview this menu" means; scheduling only drives the automatic pick.
  const menu = menuSlug ? candidates[0] : pickActiveMenu(candidates, { dayOfWeek, minutes, at });

  if (!menu) {
    return {
      branch,
      menu: null,
      reason: candidates.length ? "NO_MENU_SCHEDULED_NOW" : "NO_MENU_CONFIGURED",
      sections: [],
    };
  }

  const [sections, rows] = await Promise.all([
    prisma.menuSection.findMany({
      where: { menuId: menu.id, isActive: true },
      select: SECTION_SELECT,
      orderBy: { sortOrder: "asc" },
    }),
    prisma.menuItem.findMany({
      where: {
        menuId: menu.id,
        product: { isActive: true, deletedAt: null },
        variant: { isActive: true },
      },
      select: ITEM_WITH_PRODUCT,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);

  const shaped = rows.map((item) => shapeItem(item, at)).filter((item) => includeUnavailable || item.available);

  // Variants of one product are collapsed back into a single card with a size
  // picker, which is how a customer thinks about it.
  const byProduct = new Map();
  for (const item of shaped) {
    const key = `${item.sectionId ?? "none"}:${item.productId}`;
    const entry = byProduct.get(key);
    const variant = {
      menuItemId: item.id,
      variantId: item.variantId,
      name: item.variant.name,
      price: item.price,
      basePrice: item.basePrice,
      compareAtPrice: item.variant.compareAtPrice != null ? Number(item.variant.compareAtPrice) : null,
      available: item.available,
      sortOrder: item.variant.sortOrder,
    };

    if (entry) {
      entry.variants.push(variant);
      entry.isRecommended = entry.isRecommended || item.isRecommended;
      continue;
    }

    byProduct.set(key, {
      productId: item.productId,
      name: item.product.name,
      slug: item.product.slug,
      imageUrl: item.product.imageUrl,
      type: item.product.type,
      dietary: item.product.dietary,
      spiceLevel: item.product.spiceLevel,
      prepTimeMinutes: item.product.prepTimeMinutes,
      category: item.product.category,
      sectionId: item.sectionId,
      isRecommended: item.isRecommended,
      sortOrder: item.sortOrder,
      variants: [variant],
    });
  }

  const products = [...byProduct.values()].map((product) => ({
    ...product,
    variants: product.variants.sort((a, b) => a.sortOrder - b.sortOrder || a.price - b.price),
    priceFrom: Math.min(...product.variants.map((variant) => variant.price)),
  }));

  const grouped = sections.map((section) => ({
    ...section,
    products: products.filter((product) => product.sectionId === section.id),
  }));

  const unsectioned = products.filter((product) => !product.sectionId);
  if (unsectioned.length) {
    // Products added without a section still have to appear somewhere.
    grouped.push({ id: null, menuId: menu.id, name: "More", description: null, imageUrl: null, sortOrder: 9999, isActive: true, products: unsectioned });
  }

  return {
    branch,
    menu,
    reason: null,
    sections: grouped.filter((section) => section.products.length > 0),
    productCount: products.length,
  };
}
