import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { assertBalanced, money, reverseLines, totals } from "@/server/accounting/balance";
import { trialBalance } from "@/server/accounting/reports";
import { assertPostable } from "@/server/services/fiscal.service";

/**
 * The journal engine.
 *
 * Everything that reaches the general ledger comes through `postJournal`. Not
 * most things — everything. That single path is what makes three claims true at
 * once, and none of them survives a second writer:
 *
 *   * **Every entry balances.** Postgres cannot express "debits equal credits"
 *     because it is a constraint across rows, so it is enforced here and
 *     re-checkable afterwards by `auditLedger`. A ledger where that audit
 *     passes is provably internally consistent; one where it fails has a bug it
 *     can at least locate.
 *   * **A posted entry is immutable.** No update, no delete, ever. A correction
 *     is a reversing entry that points back at the original, so the mistake and
 *     the fix are both visible. A ledger where errors disappear cannot be used
 *     to prove anything, which is the only reason to keep one.
 *   * **Nothing lands in a closed period.** The period guard runs inside the
 *     posting transaction, so a period closing concurrently cannot be posted
 *     into through a gap between the check and the write.
 *
 * Business events post through `postJournal` with a `source` and `sourceId`, so
 * any figure in any report traces back to the order, receipt, run or payout
 * that caused it.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const LINE_SELECT = {
  id: true,
  accountId: true,
  debit: true,
  credit: true,
  description: true,
  branchId: true,
  departmentId: true,
  partyType: true,
  partyId: true,
  sortOrder: true,
  account: { select: { id: true, code: true, name: true, type: true, normalBalance: true } },
};

const SELECT = {
  id: true,
  entryNumber: true,
  branchId: true,
  periodId: true,
  entryDate: true,
  status: true,
  source: true,
  sourceId: true,
  memo: true,
  currency: true,
  totalDebit: true,
  totalCredit: true,
  orderId: true,
  paymentId: true,
  goodsReceiptId: true,
  productionOrderId: true,
  supplierBillId: true,
  expenseId: true,
  driverPayoutId: true,
  reversalOfId: true,
  postedById: true,
  postedAt: true,
  createdById: true,
  createdAt: true,
  period: { select: { id: true, name: true, status: true } },
  reversedBy: { select: { id: true, entryNumber: true } },
  lines: { select: LINE_SELECT, orderBy: { sortOrder: "asc" } },
};

/**
 * The real foreign keys an entry may carry.
 *
 * Passed explicitly by each posting rule rather than inferred from the source
 * name, because the two are not the same thing and inferring them is wrong in
 * three separate ways: a BILL_PAYMENT's `sourceId` is a payment id but its
 * foreign key is the bill's; a REFUND's is a refund id while the column is
 * `paymentId`; and a COGS entry's `sourceId` is a synthetic `<orderId>:COGS`
 * that is not an order id at all. Each one writes a value into a column that
 * does not accept it, so the posting fails and the ledger silently goes short.
 */
const LINK_FIELDS = [
  "orderId",
  "paymentId",
  "goodsReceiptId",
  "productionOrderId",
  "supplierBillId",
  "expenseId",
  "driverPayoutId",
  "payrollPeriodId",
];

function linkFields(links = {}) {
  const data = {};
  for (const field of LINK_FIELDS) {
    if (links[field]) data[field] = links[field];
  }
  return data;
}

async function allocateEntryNumber(tx, { branch, entryDate }) {
  return nextDocumentNumber(tx, {
    documentType: "JOURNAL_ENTRY",
    branchId: branch?.id ?? null,
    periodKey: monthPeriodKey(entryDate, branch?.timezone ?? "UTC"),
    prefix: branch?.code ? `JE-${branch.code}` : "JE",
    padding: 5,
  });
}

/**
 * Resolves account codes to ids.
 *
 * Posting rules speak in codes so they can stay pure; this is where those
 * become real accounts. A missing or inactive account is refused loudly — a
 * posting that silently dropped a line would produce an unbalanced entry, and
 * one that invented an account would put real money somewhere nobody looks.
 */
export async function resolveAccounts(lines, tx = prisma) {
  const codes = [...new Set(lines.map((line) => line.accountCode).filter(Boolean))];
  const ids = [...new Set(lines.map((line) => line.accountId).filter(Boolean))];

  const accounts = await tx.account.findMany({
    where: { OR: [{ code: { in: codes } }, { id: { in: ids } }] },
    select: { id: true, code: true, name: true, isActive: true },
  });

  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const byId = new Map(accounts.map((account) => [account.id, account]));

  return lines.map((line, index) => {
    const account = line.accountId ? byId.get(line.accountId) : byCode.get(line.accountCode);

    if (!account) {
      throw ApiError.validation(`Account ${line.accountCode ?? line.accountId} not found`, {
        [`lines.${index}.accountCode`]: ["No such account. Run the chart of accounts seed."],
      });
    }
    if (!account.isActive) {
      throw ApiError.conflict(`${account.code} ${account.name} is not active`, {
        accountId: account.id,
        hint: "Reactivate the account or post to another one",
      });
    }

    return { ...line, accountId: account.id, accountCode: account.code };
  });
}

/**
 * Posts a balanced entry.
 *
 * `idempotencyKey` — normally `${source}:${sourceId}` — makes a redelivered
 * outbox event a no-op rather than a second set of books. It is enforced with
 * an advisory lock on the key for the life of the transaction, not just a
 * read-then-write: two workers handed the same event by a lapsed lease would
 * otherwise both look, both find nothing, and both post.
 */
export async function postJournal({
  branchId = null,
  entryDate = new Date(),
  source = "MANUAL",
  sourceId = null,
  memo = null,
  lines,
  currency = null,
  links = {},
  idempotencyKey = null,
  status = "POSTED",
  actor = null,
  tx: outerTx = null,
}) {
  const checked = assertBalanced(lines);

  const run = async (tx) => {
    const key = idempotencyKey ?? (sourceId ? `${source}:${sourceId}` : null);

    if (key) {
      // Serialises everyone posting for this source, so the check below is
      // safe against a concurrent duplicate rather than merely usually right.
      //
      // `$executeRaw`, not `$queryRaw`: the lock function returns `void`, and
      // asking Prisma to deserialize a void column fails the whole statement —
      // which silently stopped every business event from reaching the ledger.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

      const existing = await tx.journalEntry.findFirst({
        where: { source, sourceId, status: { not: "VOID" } },
        select: SELECT,
      });
      if (existing) return { ...existing, duplicate: true };
    }

    const branch = branchId
      ? await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, timezone: true, currency: true } })
      : null;

    // The period guard runs inside the transaction: a period closing between a
    // check outside and the write would let an entry slip into a closed month.
    const period = status === "POSTED" ? await assertPostable(entryDate, tx) : null;

    const resolved = await resolveAccounts(checked.lines, tx);
    const entryNumber = await allocateEntryNumber(tx, { branch, entryDate });

    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        branchId,
        periodId: period?.id ?? null,
        entryDate: new Date(entryDate),
        status,
        source,
        sourceId,
        ...linkFields(links),
        memo,
        currency: currency ?? branch?.currency ?? "PKR",
        totalDebit: checked.totalDebit,
        totalCredit: checked.totalCredit,
        postedById: status === "POSTED" ? actor?.userId ?? null : null,
        postedAt: status === "POSTED" ? new Date() : null,
        createdById: actor?.userId ?? null,
        lines: {
          create: resolved.map((line, index) => ({
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description ?? null,
            branchId: line.branchId ?? branchId,
            departmentId: line.departmentId ?? null,
            partyType: line.partyType ?? null,
            partyId: line.partyId ?? null,
            sortOrder: line.sortOrder ?? index,
          })),
        },
      },
      select: SELECT,
    });

    return { ...entry, duplicate: false };
  };

  // A caller already inside a transaction passes it in, so the entry commits
  // or rolls back with whatever caused it.
  return outerTx ? run(outerTx) : withTransaction(run);
}

async function loadEntry(id) {
  const entry = await prisma.journalEntry.findUnique({ where: { id }, select: SELECT });
  if (!entry) throw ApiError.notFound("Journal entry not found");
  return entry;
}

export async function getJournalEntry(id) {
  return loadEntry(id);
}

/**
 * A manual entry, typed by a person.
 *
 * Created as a draft by default so a second pair of eyes can post it — the
 * reason `journal_entries.create` and `journal_entries.post` are separate
 * permissions. A manual entry is the one posting that no business event
 * justifies, which is exactly why it wants a control around it.
 */
export async function createManualEntry(data, actor) {
  return postJournal({
    branchId: data.branchId ?? null,
    entryDate: data.entryDate ?? new Date(),
    source: "MANUAL",
    sourceId: null,
    memo: data.memo ?? null,
    lines: data.lines,
    currency: data.currency ?? null,
    status: data.post ? "POSTED" : "DRAFT",
    actor,
  });
}

/** Posts a draft. The period is checked now, not when the draft was written. */
export async function postDraftEntry(id, actor) {
  const entry = await loadEntry(id);

  if (entry.status === "POSTED") return entry;
  if (entry.status === "VOID") throw ApiError.conflict("A void entry cannot be posted");

  const checked = assertBalanced(
    entry.lines.map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit })),
  );

  const posted = await withTransaction(async (tx) => {
    const period = await assertPostable(entry.entryDate, tx);

    return tx.journalEntry.update({
      where: { id },
      data: {
        status: "POSTED",
        periodId: period.id,
        postedById: actor?.userId ?? null,
        postedAt: new Date(),
        totalDebit: checked.totalDebit,
        totalCredit: checked.totalCredit,
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: entry.branchId,
    action: "journal_entry.post",
    entityType: "JournalEntry",
    entityId: id,
    changes: { entryNumber: entry.entryNumber, totalDebit: Number(checked.totalDebit) },
  });

  return posted;
}

/**
 * Reverses a posted entry.
 *
 * The only way to correct one. Every line is flipped into a new entry that
 * points back at the original, and the original is left exactly as it was.
 *
 * The reversal is dated today by default rather than on the original's date:
 * back-dating it into a period that has since been reported would change
 * figures somebody has already published. A caller that genuinely needs the
 * correction in the original period can say so, and the period guard will
 * decide whether that is still allowed.
 */
export async function reverseJournalEntry(id, { reason = null, entryDate = null, actor }) {
  const entry = await loadEntry(id);

  if (entry.status !== "POSTED") {
    throw ApiError.conflict(`Only a posted entry can be reversed; this one is ${entry.status.toLowerCase()}`, {
      status: entry.status,
    });
  }
  if (entry.reversedBy) {
    throw ApiError.conflict("This entry has already been reversed", {
      reversalId: entry.reversedBy.id,
      entryNumber: entry.reversedBy.entryNumber,
    });
  }

  const flipped = reverseLines(entry.lines);

  const reversal = await withTransaction(async (tx) => {
    const created = await postJournal({
      branchId: entry.branchId,
      entryDate: entryDate ?? new Date(),
      source: entry.source,
      sourceId: null,
      memo: reason ? `Reversal of ${entry.entryNumber}: ${reason}` : `Reversal of ${entry.entryNumber}`,
      lines: flipped,
      currency: entry.currency,
      actor,
      tx,
    });

    await tx.journalEntry.update({ where: { id: created.id }, data: { reversalOfId: entry.id } });

    return created;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: entry.branchId,
    action: "journal_entry.reverse",
    entityType: "JournalEntry",
    entityId: id,
    changes: { entryNumber: entry.entryNumber, reversalNumber: reversal.entryNumber, reason },
  });

  return reversal;
}

/** Voids a draft. A posted entry is reversed, never voided. */
export async function voidDraftEntry(id, { reason = null, actor }) {
  const entry = await loadEntry(id);

  if (entry.status === "POSTED") {
    throw ApiError.conflict("A posted entry cannot be voided. Reverse it instead.", {
      hint: `POST /admin/journal-entries/${id}/reverse`,
    });
  }

  const voided = await prisma.journalEntry.update({
    where: { id },
    data: { status: "VOID", memo: reason ?? entry.memo },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: entry.branchId,
    action: "journal_entry.void",
    entityType: "JournalEntry",
    entityId: id,
    changes: { entryNumber: entry.entryNumber, reason },
  });

  return voided;
}

export async function listJournalEntries({
  branchId,
  source,
  status,
  periodId,
  accountId,
  from,
  to,
  limit = 20,
  cursor,
} = {}) {
  const rows = await prisma.journalEntry.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
      ...(periodId ? { periodId } : {}),
      ...(accountId ? { lines: { some: { accountId } } } : {}),
      ...(from || to
        ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      entryNumber: true,
      branchId: true,
      entryDate: true,
      status: true,
      source: true,
      sourceId: true,
      memo: true,
      totalDebit: true,
      totalCredit: true,
      reversalOfId: true,
      period: { select: { id: true, name: true, status: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(({ _count, ...row }) => ({ ...row, lineCount: _count.lines })) };
}

/**
 * Account balances over a window, as the reports consume them.
 *
 * Grouped in the database rather than by walking entries, because a year of a
 * busy restaurant is a lot of lines and every statement needs this.
 */
export async function accountBalances({ branchId = null, from = null, to = null, accountIds = null } = {}) {
  const grouped = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      entry: {
        status: "POSTED",
        ...(branchId ? { branchId } : {}),
        ...(from || to
          ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    },
    _sum: { debit: true, credit: true },
  });

  const accounts = await prisma.account.findMany({
    where: { id: { in: grouped.map((row) => row.accountId) } },
    select: { id: true, code: true, name: true, type: true, subType: true, normalBalance: true },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));

  return grouped
    .map((row) => {
      const account = byId.get(row.accountId);
      if (!account) return null;

      return {
        accountId: row.accountId,
        code: account.code,
        name: account.name,
        type: account.type,
        subType: account.subType,
        normalBalance: account.normalBalance,
        debit: money(row._sum.debit ?? 0),
        credit: money(row._sum.credit ?? 0),
      };
    })
    .filter(Boolean);
}

export async function trialBalanceReport({ branchId, from, to } = {}) {
  const rows = await accountBalances({ branchId, from, to });
  const balances = rows.map((row) => ({
    ...row,
    balance: row.normalBalance === "DEBIT" ? D(row.debit).minus(D(row.credit)) : D(row.credit).minus(D(row.debit)),
  }));

  return { ...trialBalance(balances), from: from ?? null, to: to ?? null, branchId: branchId ?? null };
}

/**
 * Re-checks that the ledger adds up.
 *
 * The claim the whole module rests on, made testable. Two questions: does every
 * individual entry balance, and do the columns agree overall. A failure here
 * means something wrote to `JournalLine` without going through `postJournal`,
 * and the entries it names are where to look.
 */
export async function auditLedger({ from = null, to = null } = {}) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      status: "POSTED",
      ...(from || to
        ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      entryNumber: true,
      entryDate: true,
      totalDebit: true,
      totalCredit: true,
      lines: { select: { debit: true, credit: true } },
    },
  });

  const unbalanced = [];
  let ledgerDebit = D(0);
  let ledgerCredit = D(0);

  for (const entry of entries) {
    const actual = totals(entry.lines);
    ledgerDebit = ledgerDebit.plus(D(actual.totalDebit));
    ledgerCredit = ledgerCredit.plus(D(actual.totalCredit));

    // Both checks matter: the lines must balance against each other, and the
    // cached totals on the entry must match the lines they claim to mirror.
    const mirrors =
      D(entry.totalDebit).equals(D(actual.totalDebit)) && D(entry.totalCredit).equals(D(actual.totalCredit));

    if (!actual.balanced || !mirrors) {
      unbalanced.push({
        id: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        lineDebit: actual.totalDebit,
        lineCredit: actual.totalCredit,
        storedDebit: money(entry.totalDebit),
        storedCredit: money(entry.totalCredit),
        problem: !actual.balanced ? "LINES_DO_NOT_BALANCE" : "TOTALS_DO_NOT_MATCH_LINES",
      });
    }
  }

  return {
    entriesChecked: entries.length,
    unbalanced,
    ledgerDebit: money(ledgerDebit),
    ledgerCredit: money(ledgerCredit),
    difference: money(ledgerDebit.minus(ledgerCredit)),
    healthy: unbalanced.length === 0 && money(ledgerDebit.minus(ledgerCredit)).isZero(),
  };
}
