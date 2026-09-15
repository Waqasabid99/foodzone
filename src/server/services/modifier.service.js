import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";

/**
 * Modifier groups: "Choose your size", "Add extras".
 *
 * Groups are reusable across products, which is the whole point — "Extras" is
 * authored once and attached to thirty burgers. A product may then tighten the
 * rules for itself (`ProductModifierGroup.minSelect` / `maxSelect`), so the
 * effective rule is always "the product's override, else the group's".
 *
 * The selection rules are validated on write rather than only at checkout,
 * because an impossible group (`minSelect: 3` over two options) is a trap that
 * only surfaces when a customer cannot complete an order.
 */

const OPTION_SELECT = {
  id: true,
  name: true,
  priceDelta: true,
  sku: true,
  isDefault: true,
  isActive: true,
  sortOrder: true,
};

const GROUP_SELECT = {
  id: true,
  name: true,
  internalName: true,
  selectionType: true,
  minSelect: true,
  maxSelect: true,
  allowQuantity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  options: { select: OPTION_SELECT, orderBy: { sortOrder: "asc" } },
};

/**
 * Checks a group's rules against the options it will actually have.
 *
 * `optionCount` is passed in rather than read here so the same function guards
 * creation (options not yet written), rule edits and option deletion.
 */
export function assertRulesAreSatisfiable({ selectionType, minSelect, maxSelect, optionCount, allowQuantity }) {
  if (selectionType === "SINGLE" && maxSelect > 1) {
    throw ApiError.validation("A single-choice group cannot allow more than one selection", {
      maxSelect: ["Use MULTIPLE, or set maxSelect to 1"],
    });
  }
  if (minSelect > maxSelect) {
    throw ApiError.validation("The minimum cannot exceed the maximum", {
      minSelect: ["Must be less than or equal to maxSelect"],
    });
  }
  // With `allowQuantity` one option can satisfy a minimum of three (three
  // cheeses), so the option count only has to cover the minimum without it.
  if (!allowQuantity && optionCount > 0 && minSelect > optionCount) {
    throw ApiError.validation("This group asks for more choices than it offers", {
      minSelect: [`Only ${optionCount} option(s) available`],
    });
  }
}

function assertDefaultsFit({ selectionType, options }) {
  const defaults = options.filter((option) => option.isDefault);
  if (selectionType === "SINGLE" && defaults.length > 1) {
    throw ApiError.validation("A single-choice group can pre-select only one option", {
      options: ["Mark a single default"],
    });
  }
}

export async function listModifierGroups({ search, isActive } = {}) {
  const rows = await prisma.modifierGroup.findMany({
    where: {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { internalName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { ...GROUP_SELECT, _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });

  return rows.map(({ _count, ...row }) => ({ ...row, productCount: _count.products }));
}

export async function getModifierGroup(id) {
  const group = await prisma.modifierGroup.findUnique({
    where: { id },
    select: {
      ...GROUP_SELECT,
      products: {
        select: { product: { select: { id: true, name: true, slug: true } }, isRequired: true },
      },
    },
  });
  if (!group) throw ApiError.notFound("Modifier group not found");

  return { ...group, products: group.products.map((row) => ({ ...row.product, isRequired: row.isRequired })) };
}

export async function createModifierGroup(data) {
  const { options = [], ...group } = data;

  assertRulesAreSatisfiable({ ...group, optionCount: options.length });
  assertDefaultsFit({ selectionType: group.selectionType, options });

  const created = await prisma.modifierGroup.create({
    data: {
      ...group,
      options: { create: options.map((option, index) => ({ ...option, sortOrder: option.sortOrder ?? index })) },
    },
    select: { id: true },
  });

  return getModifierGroup(created.id);
}

export async function updateModifierGroup(id, data) {
  const existing = await prisma.modifierGroup.findUnique({
    where: { id },
    select: { ...GROUP_SELECT, _count: { select: { options: { where: { isActive: true } } } } },
  });
  if (!existing) throw ApiError.notFound("Modifier group not found");

  const merged = { ...existing, ...data };
  assertRulesAreSatisfiable({ ...merged, optionCount: existing._count.options });

  await prisma.modifierGroup.update({ where: { id }, data });
  return getModifierGroup(id);
}

export async function deleteModifierGroup(id) {
  const group = await prisma.modifierGroup.findUnique({
    where: { id },
    select: { id: true, _count: { select: { products: true } } },
  });
  if (!group) throw ApiError.notFound("Modifier group not found");

  if (group._count.products > 0) {
    throw ApiError.conflict(
      `This group is attached to ${group._count.products} product(s). Detach it first, or deactivate the group.`,
    );
  }

  await prisma.modifierGroup.delete({ where: { id } });
  return { deleted: true, id };
}

// --- options ----------------------------------------------------------------

export async function addOption(groupId, data) {
  const group = await prisma.modifierGroup.findUnique({
    where: { id: groupId },
    select: { id: true, selectionType: true, options: { select: { id: true, name: true, isDefault: true } } },
  });
  if (!group) throw ApiError.notFound("Modifier group not found");

  const clash = group.options.some((option) => option.name.toLowerCase() === data.name.trim().toLowerCase());
  if (clash) throw ApiError.conflict(`This group already has an option called "${data.name}"`);

  assertDefaultsFit({ selectionType: group.selectionType, options: [...group.options, data] });

  return prisma.modifierOption.create({
    data: { ...data, groupId, sortOrder: data.sortOrder ?? group.options.length },
    select: OPTION_SELECT,
  });
}

export async function updateOption({ groupId, optionId, data }) {
  const option = await prisma.modifierOption.findFirst({
    where: { id: optionId, groupId },
    select: { id: true, group: { select: { selectionType: true } } },
  });
  if (!option) throw ApiError.notFound("Modifier option not found");

  if (data.name) {
    const clash = await prisma.modifierOption.findFirst({
      where: { groupId, id: { not: optionId }, name: { equals: data.name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`This group already has an option called "${data.name}"`);
  }

  // A single-choice group has one pre-selection: setting a new default clears
  // the old one rather than rejecting the edit.
  return withTransaction(async (tx) => {
    if (data.isDefault && option.group.selectionType === "SINGLE") {
      await tx.modifierOption.updateMany({ where: { groupId, id: { not: optionId } }, data: { isDefault: false } });
    }
    return tx.modifierOption.update({ where: { id: optionId }, data, select: OPTION_SELECT });
  });
}

export async function deleteOption({ groupId, optionId }) {
  const option = await prisma.modifierOption.findFirst({
    where: { id: optionId, groupId },
    select: { id: true, _count: { select: { orderItemMods: true } } },
  });
  if (!option) throw ApiError.notFound("Modifier option not found");

  if (option._count.orderItemMods > 0) {
    throw ApiError.conflict("This option has been ordered. Deactivate it instead of deleting it.");
  }

  const group = await prisma.modifierGroup.findUnique({
    where: { id: groupId },
    select: { selectionType: true, minSelect: true, maxSelect: true, allowQuantity: true },
  });
  const remaining = await prisma.modifierOption.count({ where: { groupId, id: { not: optionId }, isActive: true } });
  // Removing the option must not leave the group asking for more than it offers.
  assertRulesAreSatisfiable({ ...group, optionCount: remaining });

  await prisma.modifierOption.delete({ where: { id: optionId } });
  return { deleted: true, id: optionId };
}

// --- attaching to products --------------------------------------------------

export async function listProductModifierGroups(productId) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
  if (!product) throw ApiError.notFound("Product not found");

  const rows = await prisma.productModifierGroup.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: {
      isRequired: true,
      minSelect: true,
      maxSelect: true,
      sortOrder: true,
      group: { select: GROUP_SELECT },
    },
  });

  return rows.map((row) => ({
    ...row.group,
    isRequired: row.isRequired,
    // What the client should enforce: the override if there is one.
    minSelect: row.minSelect ?? row.group.minSelect,
    maxSelect: row.maxSelect ?? row.group.maxSelect,
    overrides: { minSelect: row.minSelect, maxSelect: row.maxSelect },
    sortOrder: row.sortOrder,
  }));
}

export async function attachModifierGroup(productId, { groupId, ...rules }) {
  const [product, group] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } }),
    prisma.modifierGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        selectionType: true,
        minSelect: true,
        maxSelect: true,
        allowQuantity: true,
        _count: { select: { options: { where: { isActive: true } } } },
      },
    }),
  ]);
  if (!product) throw ApiError.notFound("Product not found");
  if (!group) throw ApiError.notFound("Modifier group not found");

  const existing = await prisma.productModifierGroup.findUnique({
    where: { productId_groupId: { productId, groupId } },
    select: { productId: true },
  });
  if (existing) throw ApiError.conflict("That modifier group is already attached to this product");

  assertRulesAreSatisfiable({
    selectionType: group.selectionType,
    minSelect: rules.minSelect ?? group.minSelect,
    maxSelect: rules.maxSelect ?? group.maxSelect,
    allowQuantity: group.allowQuantity,
    optionCount: group._count.options,
  });
  // "Required" and "zero minimum" contradict each other; resolve it here so
  // checkout never has to guess.
  if (rules.isRequired && (rules.minSelect ?? group.minSelect) < 1) rules.minSelect = 1;

  const count = await prisma.productModifierGroup.count({ where: { productId } });
  await prisma.productModifierGroup.create({
    data: { productId, groupId, ...rules, sortOrder: rules.sortOrder ?? count },
  });

  return listProductModifierGroups(productId);
}

export async function updateAttachedGroup({ productId, groupId, data }) {
  const attachment = await prisma.productModifierGroup.findUnique({
    where: { productId_groupId: { productId, groupId } },
    select: {
      isRequired: true,
      minSelect: true,
      maxSelect: true,
      group: {
        select: {
          selectionType: true,
          minSelect: true,
          maxSelect: true,
          allowQuantity: true,
          _count: { select: { options: { where: { isActive: true } } } },
        },
      },
    },
  });
  if (!attachment) throw ApiError.notFound("That modifier group is not attached to this product");

  const merged = { ...attachment, ...data };
  assertRulesAreSatisfiable({
    selectionType: attachment.group.selectionType,
    minSelect: merged.minSelect ?? attachment.group.minSelect,
    maxSelect: merged.maxSelect ?? attachment.group.maxSelect,
    allowQuantity: attachment.group.allowQuantity,
    optionCount: attachment.group._count.options,
  });

  await prisma.productModifierGroup.update({ where: { productId_groupId: { productId, groupId } }, data });
  return listProductModifierGroups(productId);
}

export async function detachModifierGroup({ productId, groupId }) {
  const attachment = await prisma.productModifierGroup.findUnique({
    where: { productId_groupId: { productId, groupId } },
    select: { productId: true },
  });
  if (!attachment) throw ApiError.notFound("That modifier group is not attached to this product");

  await prisma.productModifierGroup.delete({ where: { productId_groupId: { productId, groupId } } });
  return { detached: true, productId, groupId };
}
