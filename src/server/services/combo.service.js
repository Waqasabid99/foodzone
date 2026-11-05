import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";

/**
 * Combos: "Pick 1 burger, 1 side, 1 drink".
 *
 * A combo is a Product of type COMBO whose price is its own variant's base
 * price plus each chosen option's `priceDelta`. Modelling it as a product means
 * a combo can sit on a menu, be discounted, be attributed to a creator video
 * and appear in reports without any of those systems learning a second concept.
 *
 * Two rules are enforced here and nowhere else:
 *   * a combo cannot contain a combo — nesting makes pricing, stock explosion
 *     and the "what did they actually eat" report unbounded
 *   * a group cannot demand more picks than it offers
 */

const OPTION_SELECT = {
  id: true,
  quantity: true,
  priceDelta: true,
  isDefault: true,
  sortOrder: true,
  productId: true,
  variantId: true,
  // `deletedAt` and the variant's `isActive` are what the admin screen needs to
  // warn that a choice can no longer be sold.
  product: { select: { id: true, name: true, slug: true, imageUrl: true, isActive: true, deletedAt: true, type: true } },
  variant: { select: { id: true, name: true, price: true, isActive: true } },
};

const GROUP_SELECT = {
  id: true,
  comboProductId: true,
  name: true,
  minSelect: true,
  maxSelect: true,
  sortOrder: true,
  options: { select: OPTION_SELECT, orderBy: { sortOrder: "asc" } },
};

async function assertIsCombo(comboProductId) {
  const product = await prisma.product.findFirst({
    where: { id: comboProductId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!product) throw ApiError.notFound("Product not found");
  if (product.type !== "COMBO") {
    throw ApiError.validation("Combo groups can only be added to a product of type COMBO", {
      type: ["Set the product's type to COMBO first"],
    });
  }
  return product;
}

function assertGroupRules({ minSelect, maxSelect, optionCount }) {
  if (minSelect > maxSelect) {
    throw ApiError.validation("The minimum cannot exceed the maximum", {
      minSelect: ["Must be less than or equal to maxSelect"],
    });
  }
  if (optionCount > 0 && minSelect > optionCount) {
    throw ApiError.validation("This group asks for more choices than it offers", {
      minSelect: [`Only ${optionCount} option(s) available`],
    });
  }
}

/**
 * A slot cannot pre-select more choices than a customer is allowed to pick.
 * The storefront would open the combo already over the limit.
 */
function assertDefaultsFit({ maxSelect, defaults }) {
  if (defaults > maxSelect) {
    throw ApiError.validation(`This slot allows ${maxSelect} pick${maxSelect === 1 ? "" : "s"}, so it can pre-select at most that many`, {
      isDefault: ["Clear another default first"],
    });
  }
}

/**
 * Validates one option and resolves the variant it points at.
 *
 * A missing `variantId` means "the product's default variant" — resolved now
 * rather than at checkout, so the combo's price is knowable from its
 * definition alone.
 */
async function resolveOption({ comboProductId, option }) {
  const product = await prisma.product.findFirst({
    where: { id: option.productId, deletedAt: null },
    select: {
      id: true,
      type: true,
      variants: { where: { isActive: true }, select: { id: true, isDefault: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!product) throw ApiError.validation("Option product not found", { productId: ["No such product"] });

  if (product.id === comboProductId) {
    throw ApiError.validation("A combo cannot contain itself", { productId: ["Choose a different product"] });
  }
  if (product.type === "COMBO") {
    throw ApiError.validation("A combo cannot contain another combo", {
      productId: ["Add the individual products instead"],
    });
  }
  if (!product.variants.length) {
    throw ApiError.validation("That product has no active variant to sell", { productId: ["Activate a variant first"] });
  }

  let variantId = option.variantId ?? null;
  if (variantId) {
    const variant = product.variants.find((row) => row.id === variantId);
    if (!variant) {
      throw ApiError.validation("That variant does not belong to the chosen product", {
        variantId: ["Pick a variant of this product"],
      });
    }
  } else {
    variantId = (product.variants.find((row) => row.isDefault) ?? product.variants[0]).id;
  }

  return { ...option, variantId };
}

export async function listComboGroups(comboProductId) {
  await assertIsCombo(comboProductId);

  return prisma.comboGroup.findMany({
    where: { comboProductId },
    select: GROUP_SELECT,
    orderBy: { sortOrder: "asc" },
  });
}

export async function createComboGroup(comboProductId, data) {
  await assertIsCombo(comboProductId);

  const { options = [], ...group } = data;
  assertGroupRules({ ...group, optionCount: options.length });
  assertDefaultsFit({ maxSelect: group.maxSelect, defaults: options.filter((option) => option.isDefault).length });

  const resolved = [];
  for (const option of options) resolved.push(await resolveOption({ comboProductId, option }));

  const seen = new Set();
  for (const option of resolved) {
    const key = `${option.productId}:${option.variantId}`;
    if (seen.has(key)) throw ApiError.validation("The same choice is listed twice in this group");
    seen.add(key);
  }

  const count = await prisma.comboGroup.count({ where: { comboProductId } });
  const created = await prisma.comboGroup.create({
    data: {
      ...group,
      comboProductId,
      sortOrder: group.sortOrder ?? count,
      options: { create: resolved.map((option, index) => ({ ...option, sortOrder: option.sortOrder ?? index })) },
    },
    select: GROUP_SELECT,
  });

  return created;
}

export async function updateComboGroup({ comboProductId, groupId, data }) {
  const group = await prisma.comboGroup.findFirst({
    where: { id: groupId, comboProductId },
    select: {
      id: true,
      minSelect: true,
      maxSelect: true,
      _count: { select: { options: true } },
      options: { where: { isDefault: true }, select: { id: true } },
    },
  });
  if (!group) throw ApiError.notFound("Combo group not found");

  assertGroupRules({ ...group, ...data, optionCount: group._count.options });
  assertDefaultsFit({ maxSelect: data.maxSelect ?? group.maxSelect, defaults: group.options.length });

  return prisma.comboGroup.update({ where: { id: groupId }, data, select: GROUP_SELECT });
}

export async function deleteComboGroup({ comboProductId, groupId }) {
  const group = await prisma.comboGroup.findFirst({ where: { id: groupId, comboProductId }, select: { id: true } });
  if (!group) throw ApiError.notFound("Combo group not found");

  await prisma.comboGroup.delete({ where: { id: groupId } });
  return { deleted: true, id: groupId };
}

export async function addComboOption({ comboProductId, groupId, option }) {
  const group = await prisma.comboGroup.findFirst({
    where: { id: groupId, comboProductId },
    select: { id: true, maxSelect: true, options: { select: { productId: true, variantId: true, isDefault: true } } },
  });
  if (!group) throw ApiError.notFound("Combo group not found");

  if (option.isDefault) {
    assertDefaultsFit({ maxSelect: group.maxSelect, defaults: group.options.filter((row) => row.isDefault).length + 1 });
  }
  const resolved = await resolveOption({ comboProductId, option });
  const duplicate = group.options.some(
    (row) => row.productId === resolved.productId && row.variantId === resolved.variantId,
  );
  if (duplicate) throw ApiError.conflict("That choice is already in this group");

  return prisma.comboGroupOption.create({
    data: { ...resolved, groupId, sortOrder: resolved.sortOrder ?? group.options.length },
    select: OPTION_SELECT,
  });
}

export async function updateComboOption({ comboProductId, groupId, optionId, data }) {
  const option = await prisma.comboGroupOption.findFirst({
    where: { id: optionId, groupId, group: { comboProductId } },
    select: {
      id: true,
      productId: true,
      isDefault: true,
      group: { select: { maxSelect: true, options: { select: { id: true, productId: true, variantId: true, isDefault: true } } } },
    },
  });
  if (!option) throw ApiError.notFound("Combo option not found");

  // Only the variant can be re-pointed; swapping the product is a delete plus
  // an add.
  const resolved = data.variantId
    ? await resolveOption({ comboProductId, option: { productId: option.productId, variantId: data.variantId } })
    : null;

  // Re-pointing to a size the slot already offers would list the same choice
  // twice — the check `addComboOption` makes, which this path used to skip.
  if (resolved) {
    const duplicate = option.group.options.some(
      (row) => row.id !== optionId && row.productId === option.productId && row.variantId === resolved.variantId,
    );
    if (duplicate) throw ApiError.conflict("That size is already a choice in this slot");
  }
  if (data.isDefault && !option.isDefault) {
    assertDefaultsFit({
      maxSelect: option.group.maxSelect,
      defaults: option.group.options.filter((row) => row.isDefault).length + 1,
    });
  }

  return prisma.comboGroupOption.update({
    where: { id: optionId },
    data: { ...data, ...(resolved ? { variantId: resolved.variantId } : {}) },
    select: OPTION_SELECT,
  });
}

export async function deleteComboOption({ comboProductId, groupId, optionId }) {
  const option = await prisma.comboGroupOption.findFirst({
    where: { id: optionId, groupId, group: { comboProductId } },
    select: { id: true },
  });
  if (!option) throw ApiError.notFound("Combo option not found");

  const group = await prisma.comboGroup.findUnique({
    where: { id: groupId },
    select: { minSelect: true, maxSelect: true, _count: { select: { options: true } } },
  });
  // The group must still be completable once this choice is gone.
  assertGroupRules({ ...group, optionCount: group._count.options - 1 });

  await prisma.comboGroupOption.delete({ where: { id: optionId } });

  return { deleted: true, id: optionId };
}

/**
 * Slots for many combos in one query, keyed by combo id — what a list of combos
 * needs to show each one's health without a query per row.
 */
export async function comboGroupsFor(comboProductIds) {
  const byCombo = new Map(comboProductIds.map((id) => [id, []]));
  if (!comboProductIds.length) return byCombo;

  const rows = await prisma.comboGroup.findMany({
    where: { comboProductId: { in: comboProductIds } },
    select: GROUP_SELECT,
    orderBy: { sortOrder: "asc" },
  });
  for (const row of rows) byCombo.get(row.comboProductId)?.push(row);
  return byCombo;
}
