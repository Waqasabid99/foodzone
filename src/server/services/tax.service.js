import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";

/**
 * Tax groups and rates.
 *
 * The arithmetic lives in the pricing engine; this module is only about the
 * rows it reads. What makes it delicate is that these rows are already printed
 * on invoices — a tax rate is a legal statement about what was collected, and
 * changing one retroactively rewrites documents that have been filed.
 *
 * So the rule here is the same one the catalog uses for products: once a rate
 * has appeared on an order, it is deactivated rather than deleted, and edits
 * that would change history are refused. A new rate supersedes an old one; it
 * does not overwrite it.
 */

const RATE_SELECT = {
  id: true,
  name: true,
  rate: true,
  accountId: true,
  region: true,
  isCompound: true,
  sortOrder: true,
  isActive: true,
};

const GROUP_SELECT = {
  id: true,
  name: true,
  isInclusive: true,
  isActive: true,
  rates: { select: RATE_SELECT, orderBy: { sortOrder: "asc" } },
};

export async function listTaxGroups({ isActive } = {}) {
  const groups = await prisma.taxGroup.findMany({
    where: { ...(isActive !== undefined ? { isActive } : {}) },
    select: { ...GROUP_SELECT, _count: { select: { products: { where: { deletedAt: null } } } } },
    orderBy: { name: "asc" },
  });

  return groups.map(({ _count, ...group }) => ({
    ...group,
    productCount: _count.products,
    // The headline number an operator wants: what this group adds in total.
    // Compound rates make it more than the sum, so it is computed, not summed.
    effectiveRate: effectiveRate(group.rates.filter((rate) => rate.isActive)),
  }));
}

/**
 * The combined percentage a group applies.
 *
 * Exported because it is the number shown next to a product in the admin, and
 * because compound rates make it genuinely non-obvious: 10% then a compound 5%
 * is 15.5%, not 15%.
 */
export function effectiveRate(rates) {
  let factor = 1;
  for (const rate of [...rates].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const fraction = Number(rate.rate) / 100;
    factor = rate.isCompound ? factor * (1 + fraction) : factor + fraction;
  }
  return Math.round((factor - 1) * 1000000) / 10000;
}

export async function getTaxGroup(id) {
  const group = await prisma.taxGroup.findUnique({ where: { id }, select: GROUP_SELECT });
  if (!group) throw ApiError.notFound("Tax group not found");
  return { ...group, effectiveRate: effectiveRate(group.rates.filter((rate) => rate.isActive)) };
}

export async function createTaxGroup(data) {
  const clash = await prisma.taxGroup.findUnique({ where: { name: data.name }, select: { id: true } });
  if (clash) throw ApiError.conflict(`A tax group called "${data.name}" already exists`);

  const { rates = [], ...group } = data;

  return prisma.taxGroup.create({
    data: { ...group, rates: { create: rates.map(normaliseRate) } },
    select: GROUP_SELECT,
  });
}

export async function updateTaxGroup(id, data) {
  await getTaxGroup(id);

  if (data.name) {
    const clash = await prisma.taxGroup.findFirst({
      where: { name: data.name, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`A tax group called "${data.name}" already exists`);
  }

  return prisma.taxGroup.update({ where: { id }, data, select: GROUP_SELECT });
}

/**
 * Deleting a group only ever unassigns products; it never touches an order.
 * Orders carry their own `OrderTaxLine` snapshots, so history survives — but a
 * group still in use by live products is refused, because silently making a
 * hundred products tax-free is not something to do on one click.
 */
export async function deleteTaxGroup(id) {
  const group = await prisma.taxGroup.findUnique({
    where: { id },
    select: { id: true, _count: { select: { products: { where: { deletedAt: null } } } } },
  });
  if (!group) throw ApiError.notFound("Tax group not found");

  if (group._count.products > 0) {
    throw ApiError.conflict(
      `${group._count.products} product(s) still use this tax group. Move them first, or deactivate the group.`,
    );
  }

  await prisma.taxGroup.delete({ where: { id } });
  return { deleted: true, id };
}

function normaliseRate(rate) {
  return {
    name: rate.name,
    rate: rate.rate,
    accountId: rate.accountId ?? null,
    region: rate.region ?? null,
    isCompound: rate.isCompound ?? false,
    sortOrder: rate.sortOrder ?? 0,
    ...(rate.isActive !== undefined ? { isActive: rate.isActive } : {}),
  };
}

export async function addTaxRate(groupId, data) {
  await getTaxGroup(groupId);
  return prisma.taxRate.create({ data: { groupId, ...normaliseRate(data) }, select: RATE_SELECT });
}

/**
 * Editing a rate that has already been charged is refused.
 *
 * `OrderTaxLine` snapshots the rate at the time of sale, so the totals on past
 * orders would not move — but the row a tax authority follows from an invoice
 * back to its definition would then say something different from the invoice.
 * Deactivate and add a replacement instead.
 */
export async function updateTaxRate(rateId, data) {
  const rate = await prisma.taxRate.findUnique({
    where: { id: rateId },
    select: { id: true, groupId: true, _count: { select: { orderTaxLines: true } } },
  });
  if (!rate) throw ApiError.notFound("Tax rate not found");

  const changesTheNumbers = data.rate !== undefined || data.isCompound !== undefined || data.name !== undefined;
  if (rate._count.orderTaxLines > 0 && changesTheNumbers) {
    throw ApiError.conflict(
      "This rate has already been charged on orders. Deactivate it and add a new rate instead of editing it.",
      { orderTaxLines: rate._count.orderTaxLines },
    );
  }

  return prisma.taxRate.update({ where: { id: rateId }, data, select: RATE_SELECT });
}

export async function deleteTaxRate(rateId) {
  const rate = await prisma.taxRate.findUnique({
    where: { id: rateId },
    select: { id: true, _count: { select: { orderTaxLines: true } } },
  });
  if (!rate) throw ApiError.notFound("Tax rate not found");

  if (rate._count.orderTaxLines > 0) {
    throw ApiError.conflict("This rate appears on issued invoices. Deactivate it instead of deleting it.");
  }

  await prisma.taxRate.delete({ where: { id: rateId } });
  return { deleted: true, id: rateId };
}
