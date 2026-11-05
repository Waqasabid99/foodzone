import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { recordAudit } from "@/server/utils/audit";
import { formatDocumentNumber } from "@/server/utils/sequence";

/**
 * Document numbering: the counters behind order, invoice and GRN numbers.
 *
 * Only the *shape* of a number can be changed here — its prefix and how many
 * digits the counter is padded to. The counter itself is deliberately not
 * editable:
 *
 *   * moving it backwards re-issues numbers that are already on invoices and
 *     in the ledger, and the unique index then rejects the next document
 *     mid-transaction, which reads to the user as "checkout is broken";
 *   * moving it forwards leaves a gap, and a gap in a tax-facing sequence is
 *     exactly what an auditor asks about.
 *
 * Rows appear by themselves: the first document of a type, branch and period
 * creates its own counter. So this screen lists what exists rather than
 * offering a "new sequence" button.
 */

/** What each counter is for, in the words the screens use. */
export const DOCUMENT_TYPES = {
  ORDER: { label: "Orders", resets: "day" },
  INVOICE: { label: "Invoices", resets: "month" },
  GOODS_RECEIPT: { label: "Goods received", resets: "month" },
  PURCHASE_ORDER: { label: "Purchase orders", resets: "month" },
  SUPPLIER_BILL: { label: "Supplier bills", resets: "month" },
  EXPENSE: { label: "Expenses", resets: "month" },
  JOURNAL_ENTRY: { label: "Journal entries", resets: "month" },
  STOCK_ADJUSTMENT: { label: "Stock adjustments", resets: "month" },
  STOCK_TRANSFER: { label: "Stock transfers", resets: "month" },
  STOCK_COUNT: { label: "Stock counts", resets: "month" },
  PRODUCTION_ORDER: { label: "Production batches", resets: "month" },
};

export const documentTypeLabel = (type) => DOCUMENT_TYPES[type]?.label ?? type;

const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function decorate(row, branchById) {
  return {
    ...row,
    label: documentTypeLabel(row.documentType),
    branch: row.branchId ? (branchById.get(row.branchId) ?? null) : null,
    issued: Math.max(0, row.nextValue - 1),
    // What the next document of this kind will be called.
    nextNumber: formatDocumentNumber({
      prefix: row.prefix,
      periodKey: row.periodKey,
      value: row.nextValue,
      padding: row.padding,
    }),
  };
}

export async function listSequences({ documentType = null, branchId = null } = {}) {
  const rows = await prisma.numberSequence.findMany({
    where: { ...(documentType ? { documentType } : {}), ...(branchId ? { branchId } : {}) },
    orderBy: [{ documentType: "asc" }, { periodKey: "desc" }],
  });

  const branchIds = [...new Set(rows.map((row) => row.branchId).filter(Boolean))];
  const branches = branchIds.length
    ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, code: true } })
    : [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));

  return rows.map((row) => decorate(row, branchById));
}

export async function getSequence(id) {
  const row = await prisma.numberSequence.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound("Number sequence not found");
  const branch = row.branchId
    ? await prisma.branch.findUnique({ where: { id: row.branchId }, select: { id: true, name: true, code: true } })
    : null;
  return decorate(row, new Map(branch ? [[branch.id, branch]] : []));
}

/**
 * Changes what future numbers of this kind look like.
 *
 * The prefix is what keeps two branches' numbers apart, so a prefix already
 * used by another counter of the same type in the same period is refused —
 * they would start producing identical document numbers, and the unique index
 * would then fail the second branch's next order rather than this edit.
 */
export async function updateSequence(id, { prefix, padding }, actor = null) {
  const current = await prisma.numberSequence.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound("Number sequence not found");

  const next = {
    prefix: prefix === undefined ? current.prefix : String(prefix).trim(),
    padding: padding === undefined ? current.padding : Number(padding),
  };

  if (next.prefix && !PREFIX_PATTERN.test(next.prefix)) {
    throw ApiError.validation("A prefix uses letters, numbers and hyphens", {
      prefix: ["Letters, numbers and hyphens only, starting with a letter or number"],
    });
  }
  if (next.prefix.length > 20) {
    throw ApiError.validation("That prefix is too long", { prefix: ["Keep it to 20 characters"] });
  }
  if (!Number.isInteger(next.padding) || next.padding < 1 || next.padding > 10) {
    throw ApiError.validation("Padding is between 1 and 10 digits", { padding: ["Between 1 and 10"] });
  }
  // A counter already past what the padding can show would start producing
  // numbers of a different width mid-series.
  if (String(current.nextValue).length > next.padding) {
    throw ApiError.validation(`This counter has already reached ${current.nextValue}, so it needs at least ${String(current.nextValue).length} digits`, {
      padding: [`At least ${String(current.nextValue).length}`],
    });
  }

  const clash = await prisma.numberSequence.findFirst({
    where: {
      id: { not: id },
      documentType: current.documentType,
      periodKey: current.periodKey,
      prefix: next.prefix,
    },
    select: { id: true, branchId: true },
  });
  if (clash) {
    throw ApiError.conflict("Another counter of this kind already uses that prefix, so the two would produce the same numbers", {
      prefix: ["Give each branch its own prefix"],
    });
  }

  const updated = await prisma.numberSequence.update({ where: { id }, data: next });

  await recordAudit({
    actorId: actor?.userId ?? null,
    // Not stamped with the counter's branch: a sequence keeps its branch id
    // without a foreign key, and one left behind by a removed branch would
    // make the audit write fail rather than the change.
    action: "number_sequence.update",
    entityType: "NumberSequence",
    entityId: id,
    changes: {
      documentType: current.documentType,
      branchId: current.branchId,
      from: { prefix: current.prefix, padding: current.padding },
      to: { prefix: updated.prefix, padding: updated.padding },
    },
  });

  return getSequence(id);
}
