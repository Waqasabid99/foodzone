import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/access/scope";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { money } from "@/server/accounting/balance";
import { enqueue } from "@/server/jobs/outbox";

/**
 * Operating spend that is not a supplier bill: utilities, fuel, repairs, the
 * plumber who came out on a Sunday.
 *
 * Approval-gated for the same reason refunds and manual discounts are — it is
 * money leaving, recorded by the person who spent it. Only an approved expense
 * reaches the ledger, so recording one is safe to delegate widely while the
 * accounting consequence stays controlled.
 *
 * The category carries the expense account, so a restaurant configures its
 * chart once and everybody after that just picks "Utilities".
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  expenseNumber: true,
  branchId: true,
  categoryId: true,
  paidFromId: true,
  payee: true,
  description: true,
  amount: true,
  taxAmount: true,
  currency: true,
  expenseDate: true,
  status: true,
  receiptUrl: true,
  createdById: true,
  approvedById: true,
  approvedAt: true,
  createdAt: true,
  category: {
    select: { id: true, name: true, account: { select: { id: true, code: true, name: true } } },
  },
  paidFrom: { select: { id: true, code: true, name: true } },
};

const CATEGORY_SELECT = {
  id: true,
  name: true,
  accountId: true,
  isActive: true,
  account: { select: { id: true, code: true, name: true, type: true } },
  _count: { select: { expenses: true } },
};

// --- categories -------------------------------------------------------------

export async function listExpenseCategories({ isActive } = {}) {
  return prisma.expenseCategory.findMany({
    where: { ...(isActive != null ? { isActive } : {}) },
    select: CATEGORY_SELECT,
    orderBy: { name: "asc" },
  });
}

export async function createExpenseCategory(data, actor = null) {
  if (data.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      select: { id: true, type: true, name: true },
    });
    if (!account) throw ApiError.validation("Account not found", { accountId: ["No such account"] });

    // A category pointing at an income or asset account would post spend into
    // the wrong half of the books, and nothing downstream would notice.
    if (account.type !== "EXPENSE") {
      throw ApiError.validation(`${account.name} is not an expense account`, {
        accountId: ["Choose an account from the expense section"],
      });
    }
  }

  const existing = await prisma.expenseCategory.findUnique({ where: { name: data.name }, select: { id: true } });
  if (existing) throw ApiError.conflict("A category with that name already exists");

  const category = await prisma.expenseCategory.create({
    data: { name: data.name, accountId: data.accountId ?? null, isActive: data.isActive ?? true },
    select: CATEGORY_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "expense_category.create",
    entityType: "ExpenseCategory",
    entityId: category.id,
    changes: { name: category.name, accountId: data.accountId ?? null },
  });

  return category;
}

export async function updateExpenseCategory(id, data, actor = null) {
  const category = await prisma.expenseCategory.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!category) throw ApiError.notFound("Expense category not found");

  if (data.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      select: { id: true, type: true, name: true },
    });
    if (!account) throw ApiError.validation("Account not found", { accountId: ["No such account"] });
    if (account.type !== "EXPENSE") {
      throw ApiError.validation(`${account.name} is not an expense account`, {
        accountId: ["Choose an account from the expense section"],
      });
    }
  }

  return prisma.expenseCategory.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
    },
    select: CATEGORY_SELECT,
  });
}

// --- expenses ---------------------------------------------------------------

async function allocateExpenseNumber(tx, { branch }) {
  return nextDocumentNumber(tx, {
    documentType: "EXPENSE",
    branchId: branch.id,
    periodKey: monthPeriodKey(new Date(), branch.timezone),
    prefix: `EXP-${branch.code}`,
    padding: 4,
  });
}

export async function createExpense(data, actor = null) {
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { id: true, code: true, timezone: true, currency: true },
  });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  const amount = money(data.amount);
  const taxAmount = money(data.taxAmount ?? 0);

  if (amount.lessThanOrEqualTo(0)) {
    throw ApiError.validation("An expense has to be for something", { amount: ["Must be more than zero"] });
  }
  if (taxAmount.greaterThan(amount)) {
    // The tax is inside the amount, not on top of it — a tax larger than the
    // whole expense would post a negative net cost.
    throw ApiError.validation("The tax cannot be more than the expense", {
      taxAmount: [`The tax is part of the ${amount} total, not additional to it`],
    });
  }

  if (data.categoryId) {
    const category = await prisma.expenseCategory.findUnique({
      where: { id: data.categoryId },
      select: { id: true, isActive: true, name: true },
    });
    if (!category) throw ApiError.validation("Category not found", { categoryId: ["No such category"] });
    if (!category.isActive) {
      throw ApiError.validation(`${category.name} is not active`, { categoryId: ["Choose another category"] });
    }
  }

  if (data.paidFromId) {
    const account = await prisma.account.findUnique({
      where: { id: data.paidFromId },
      select: { id: true, type: true, name: true },
    });
    if (!account) throw ApiError.validation("Account not found", { paidFromId: ["No such account"] });
    if (account.type !== "ASSET") {
      throw ApiError.validation("Money has to come out of an asset account", {
        paidFromId: ["Choose a cash or bank account"],
      });
    }
  }

  const expense = await withTransaction(async (tx) => {
    const expenseNumber = await allocateExpenseNumber(tx, { branch });

    return tx.expense.create({
      data: {
        expenseNumber,
        branchId: data.branchId,
        categoryId: data.categoryId ?? null,
        paidFromId: data.paidFromId ?? null,
        payee: data.payee ?? null,
        description: data.description ?? null,
        amount,
        taxAmount,
        currency: data.currency ?? branch.currency ?? "PKR",
        expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
        status: "DRAFT",
        receiptUrl: data.receiptUrl ?? null,
        createdById: actor?.userId ?? null,
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId,
    action: "expense.create",
    entityType: "Expense",
    entityId: expense.id,
    changes: { expenseNumber: expense.expenseNumber, amount: Number(amount), payee: data.payee ?? null },
  });

  return expense;
}

async function loadExpense(id) {
  const expense = await prisma.expense.findUnique({ where: { id }, select: SELECT });
  if (!expense) throw ApiError.notFound("Expense not found");
  return expense;
}

export async function getExpense(id) {
  return loadExpense(id);
}

export async function updateExpense(id, data, actor = null) {
  const expense = await loadExpense(id);

  if (expense.status === "APPROVED") {
    throw ApiError.conflict("An approved expense is in the ledger and cannot be edited", {
      status: expense.status,
      hint: "Reverse its journal entry and record a corrected expense",
    });
  }

  return prisma.expense.update({
    where: { id },
    data: {
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.paidFromId !== undefined ? { paidFromId: data.paidFromId } : {}),
      ...(data.payee !== undefined ? { payee: data.payee } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.amount != null ? { amount: money(data.amount) } : {}),
      ...(data.taxAmount != null ? { taxAmount: money(data.taxAmount) } : {}),
      ...(data.expenseDate ? { expenseDate: new Date(data.expenseDate) } : {}),
      ...(data.receiptUrl !== undefined ? { receiptUrl: data.receiptUrl } : {}),
    },
    select: SELECT,
  });
}

export async function submitExpense(id, actor = null) {
  const expense = await loadExpense(id);
  if (expense.status !== "DRAFT") {
    throw ApiError.conflict("Only a draft expense can be submitted", { status: expense.status });
  }

  return prisma.expense.update({ where: { id }, data: { status: "PENDING_APPROVAL" }, select: SELECT });
}

/** Approving is what puts it in the books. Posted out of band, as ever. */
export async function approveExpense(id, actor) {
  const expense = await loadExpense(id);

  if (!["DRAFT", "PENDING_APPROVAL"].includes(expense.status)) {
    throw ApiError.conflict(`A ${expense.status.toLowerCase().replace(/_/g, " ")} expense cannot be approved`, {
      status: expense.status,
    });
  }

  const approved = await withTransaction(async (tx) => {
    const row = await tx.expense.update({
      where: { id },
      data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() },
      select: SELECT,
    });

    await enqueue({ eventType: "finance.expense_approved", payload: { expenseId: id }, db: tx });
    return row;
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: expense.branchId,
    action: "expense.approve",
    entityType: "Expense",
    entityId: id,
    changes: { expenseNumber: expense.expenseNumber, amount: Number(expense.amount) },
  });

  return approved;
}

export async function rejectExpense(id, { reason = null, actor }) {
  const expense = await loadExpense(id);

  if (expense.status === "APPROVED") {
    throw ApiError.conflict("This expense is already approved and in the ledger");
  }

  const rejected = await prisma.expense.update({
    where: { id },
    data: { status: "REJECTED", description: reason ? `${expense.description ?? ""}\nRejected: ${reason}`.trim() : expense.description },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: expense.branchId,
    action: "expense.reject",
    entityType: "Expense",
    entityId: id,
    changes: { expenseNumber: expense.expenseNumber, reason },
  });

  return rejected;
}

/** A posted expense is never deleted — the ledger entry explains it. */
export async function deleteExpense(id, actor = null) {
  const expense = await loadExpense(id);

  if (expense.status === "APPROVED") {
    throw ApiError.conflict("An approved expense cannot be deleted", {
      hint: "Reverse its journal entry instead",
    });
  }

  await prisma.expense.delete({ where: { id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: expense.branchId,
    action: "expense.delete",
    entityType: "Expense",
    entityId: id,
    changes: { expenseNumber: expense.expenseNumber, amount: Number(expense.amount) },
  });

  return { id, deleted: true };
}

export async function listExpenses({ branchId, categoryId, status, from, to, scope = null, limit = 20, cursor } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.expense.findMany({
    where: {
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(branchId ? { branchId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? { expenseDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      expenseNumber: true,
      branchId: true,
      status: true,
      amount: true,
      taxAmount: true,
      currency: true,
      expenseDate: true,
      payee: true,
      category: { select: { id: true, name: true } },
    },
    orderBy: { expenseDate: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/** Spend by category over a window — where the money actually went. */
export async function expenseSummary({ branchId, from, to, scope = null } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: {
      status: "APPROVED",
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(branchId ? { branchId } : {}),
      ...(from || to
        ? { expenseDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: rows.map((row) => row.categoryId).filter(Boolean) } },
    select: { id: true, name: true },
  });
  const byId = new Map(categories.map((category) => [category.id, category.name]));

  const total = rows.reduce((sum, row) => sum.plus(D(row._sum.amount)), D(0));

  return {
    total: money(total),
    categories: rows
      .map((row) => ({
        categoryId: row.categoryId,
        category: row.categoryId ? byId.get(row.categoryId) ?? "Unknown" : "Uncategorised",
        amount: money(row._sum.amount ?? 0),
        count: row._count._all,
        percentOfTotal: total.greaterThan(0)
          ? Number(D(row._sum.amount ?? 0).dividedBy(total).times(100).toDecimalPlaces(2))
          : 0,
      }))
      .sort((a, b) => Number(D(b.amount).minus(D(a.amount)))),
  };
}
