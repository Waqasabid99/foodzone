import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess, cursorArgs, toPage } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { branchFilter } from "@/server/access/scope";

/**
 * Restaurant tables.
 *
 * Tables belong to a branch and are named uniquely within it ("T-12"), which
 * is what lets a server say "table 12" without ambiguity and what a QR sticker
 * is printed against. `area` is free text rather than its own table: a
 * restaurant renames "Terrace" to "Garden" on a whim, and the value is only
 * ever used for grouping and filtering.
 */

const SELECT = {
  id: true,
  branchId: true,
  name: true,
  area: true,
  seats: true,
  isActive: true,
  createdAt: true,
};

/** Table id in, branch permission check done, branch id out. */
/** A table at a branch the caller cannot work at answers not-found, not forbidden. */
export async function assertTableAccess(principal, tableId, permissionKey) {
  const { assertRecordAccess } = await import("@/server/ordering/access");
  return assertRecordAccess(principal, "table", tableId, permissionKey);
}

export async function listTables({ branchId, area, isActive, search, scope = null, limit = 50, cursor } = {}) {
  const filter = branchFilter(scope);

  const rows = await prisma.restaurantTable.findMany({
    where: {
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(branchId ? { branchId } : {}),
      ...(area ? { area } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: { ...SELECT, _count: { select: { qrCodes: true } } },
    // Natural sort would be nicer ("T-2" before "T-10"), but names are free
    // text and Postgres has no natural collation by default. Clients that care
    // can sort; the API stays predictable.
    orderBy: [{ area: "asc" }, { name: "asc" }, { id: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(({ _count, ...row }) => ({ ...row, qrCodeCount: _count.qrCodes })) };
}

export async function getTable(id) {
  const table = await prisma.restaurantTable.findUnique({
    where: { id },
    select: {
      ...SELECT,
      branch: { select: { id: true, code: true, name: true } },
      qrCodes: { select: { id: true, code: true, label: true, isActive: true, scanCount: true } },
    },
  });
  if (!table) throw ApiError.notFound("Table not found");

  return table;
}

/** The distinct areas in use at a branch — what a filter dropdown needs. */
export async function listAreas(branchId) {
  const rows = await prisma.restaurantTable.findMany({
    where: { branchId, area: { not: null } },
    select: { area: true },
    distinct: ["area"],
    orderBy: { area: "asc" },
  });

  return rows.map((row) => row.area);
}

async function assertBranchExists(branchId) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });
  return branch;
}

export async function createTable(data) {
  await assertBranchExists(data.branchId);

  const clash = await prisma.restaurantTable.findFirst({
    where: { branchId: data.branchId, name: { equals: data.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) throw ApiError.conflict(`This branch already has a table called "${data.name}"`);

  return prisma.restaurantTable.create({ data, select: SELECT });
}

/**
 * Bulk creation, because a dining room is laid out in one go.
 *
 * `{ prefix: "T-", from: 1, to: 20 }` creates T-1 … T-20. Names that already
 * exist are skipped rather than failing the batch: re-running after adding five
 * more tables should add exactly those five.
 */
export async function createTablesInBulk({ branchId, prefix, from, to, seats, area, padTo }) {
  await assertBranchExists(branchId);

  if (to < from) {
    throw ApiError.validation("The range must not run backwards", { to: ["Must be greater than or equal to from"] });
  }

  const names = [];
  for (let index = from; index <= to; index += 1) {
    names.push(`${prefix}${padTo ? String(index).padStart(padTo, "0") : index}`);
  }

  const existing = await prisma.restaurantTable.findMany({
    where: { branchId, name: { in: names } },
    select: { name: true },
  });
  const taken = new Set(existing.map((row) => row.name.toLowerCase()));
  const toCreate = names.filter((name) => !taken.has(name.toLowerCase()));

  if (!toCreate.length) throw ApiError.conflict("Every table in that range already exists");

  await prisma.restaurantTable.createMany({
    data: toCreate.map((name) => ({ branchId, name, seats, area })),
    skipDuplicates: true,
  });

  const created = await prisma.restaurantTable.findMany({
    where: { branchId, name: { in: toCreate } },
    select: SELECT,
    orderBy: { name: "asc" },
  });

  return { created: created.length, skipped: names.length - toCreate.length, tables: created };
}

export async function updateTable(id, data) {
  const table = await prisma.restaurantTable.findUnique({ where: { id }, select: { id: true, branchId: true } });
  if (!table) throw ApiError.notFound("Table not found");

  if (data.name) {
    const clash = await prisma.restaurantTable.findFirst({
      where: { branchId: table.branchId, id: { not: id }, name: { equals: data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`This branch already has a table called "${data.name}"`);
  }

  return prisma.restaurantTable.update({ where: { id }, data, select: SELECT });
}

/**
 * Deleting a table also deactivates the QR codes pointing at it.
 *
 * The schema nulls `tableId` on delete, which would otherwise leave a printed
 * sticker resolving to the branch's default menu with no indication that the
 * table it names is gone. Deactivating makes the stale sticker fail loudly.
 */
export async function deleteTable(id) {
  const table = await prisma.restaurantTable.findUnique({
    where: { id },
    select: { id: true, _count: { select: { orders: true, qrCodes: true } } },
  });
  if (!table) throw ApiError.notFound("Table not found");

  // Order history records which table was served; that is a fact about the
  // past and must not be rewritten.
  if (table._count.orders > 0) {
    throw ApiError.conflict("This table appears in order history. Deactivate it instead of deleting it.");
  }

  const deactivated = await withTransaction(async (tx) => {
    const result = await tx.qrCode.updateMany({ where: { tableId: id }, data: { isActive: false } });
    await tx.restaurantTable.delete({ where: { id } });
    return result.count;
  });

  return { deleted: true, id, qrCodesDeactivated: deactivated };
}
