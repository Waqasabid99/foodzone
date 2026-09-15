import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { recordAudit } from "@/server/utils/audit";
import { accountBalance, money, normalBalanceFor } from "@/server/accounting/balance";
import { REQUIRED_CODES } from "@/server/accounting/chart";

/**
 * The chart of accounts.
 *
 * Seeded accounts are marked `isSystem` and are the ones the posting rules
 * resolve by code. They can be renamed and re-parented — every restaurant calls
 * things something slightly different — but their code, type and normal balance
 * are fixed, because a posting rule that credits "4100" and finds an expense
 * account there would book revenue as a cost and the books would still balance.
 * Nothing would ever flag it.
 *
 * An account that has been posted to is never deleted. It is part of the audit
 * trail for every line that referenced it; deactivation is the way to retire
 * one.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  subType: true,
  normalBalance: true,
  parentId: true,
  branchId: true,
  currency: true,
  description: true,
  isSystem: true,
  isActive: true,
  createdAt: true,
  parent: { select: { id: true, code: true, name: true } },
  _count: { select: { lines: true, children: true } },
};

function shape(account) {
  const { _count, ...rest } = account;
  return { ...rest, lineCount: _count?.lines ?? 0, childCount: _count?.children ?? 0 };
}

export async function listAccounts({ type, isActive, search, branchId } = {}) {
  const rows = await prisma.account.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(isActive != null ? { isActive } : {}),
      // Shared accounts (branchId null) apply everywhere, so a branch filter
      // has to include them or a branch view looks almost empty.
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      ...(search
        ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search } }] }
        : {}),
    },
    select: SELECT,
    orderBy: { code: "asc" },
  });

  return rows.map(shape);
}

/** The chart as a tree, which is how it is read. */
export async function accountTree({ isActive = null } = {}) {
  const accounts = await prisma.account.findMany({
    where: { ...(isActive != null ? { isActive } : {}) },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      subType: true,
      normalBalance: true,
      parentId: true,
      isSystem: true,
      isActive: true,
    },
    orderBy: { code: "asc" },
  });

  const byId = new Map(accounts.map((account) => [account.id, { ...account, children: [] }]));
  const roots = [];

  for (const account of byId.values()) {
    const parent = account.parentId ? byId.get(account.parentId) : null;
    if (parent) parent.children.push(account);
    else roots.push(account);
  }

  return roots;
}

async function loadAccount(id) {
  const account = await prisma.account.findUnique({ where: { id }, select: SELECT });
  if (!account) throw ApiError.notFound("Account not found");
  return account;
}

export async function getAccount(id) {
  return shape(await loadAccount(id));
}

export async function createAccount(data, actor = null) {
  const existing = await prisma.account.findUnique({ where: { code: data.code }, select: { id: true } });
  if (existing) throw ApiError.conflict(`Account ${data.code} already exists`);

  let parent = null;
  if (data.parentId) {
    parent = await prisma.account.findUnique({
      where: { id: data.parentId },
      select: { id: true, type: true, name: true, code: true },
    });
    if (!parent) throw ApiError.validation("Parent account not found", { parentId: ["No such account"] });

    // A cash account filed under income would land in the wrong half of every
    // statement while still balancing.
    if (parent.type !== data.type) {
      throw ApiError.validation(`${parent.code} ${parent.name} is ${parent.type.toLowerCase()}`, {
        parentId: ["A child account has to be the same type as its parent"],
      });
    }
  }

  const account = await prisma.account.create({
    data: {
      code: data.code,
      name: data.name,
      type: data.type,
      subType: data.subType ?? null,
      // Defaulted from the type rather than trusted: an asset with a credit
      // normal balance reports its own balance backwards for ever.
      normalBalance: data.normalBalance ?? normalBalanceFor(data.type),
      parentId: data.parentId ?? null,
      branchId: data.branchId ?? null,
      currency: data.currency ?? "PKR",
      description: data.description ?? null,
      isSystem: false,
      isActive: data.isActive ?? true,
    },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "account.create",
    entityType: "Account",
    entityId: account.id,
    changes: { code: account.code, name: account.name, type: account.type },
  });

  return shape(account);
}

/**
 * Edits an account.
 *
 * Code, type and normal balance are immutable once the account has been posted
 * to. Changing any of them would silently reinterpret every line already
 * written against it: the same numbers, meaning something else.
 */
export async function updateAccount(id, data, actor = null) {
  const account = await loadAccount(id);
  const posted = account.lineCount ?? account._count?.lines ?? 0;

  const structural =
    (data.code != null && data.code !== account.code) ||
    (data.type != null && data.type !== account.type) ||
    (data.normalBalance != null && data.normalBalance !== account.normalBalance);

  if (structural && account.isSystem) {
    throw ApiError.conflict("A system account's code, type and normal balance are fixed", {
      hint: "The posting rules resolve this account by code. Rename it instead.",
    });
  }

  if (structural && posted > 0) {
    throw ApiError.conflict(`${account.code} has ${posted} journal line(s) posted to it`, {
      hint: "Create a new account instead — changing this would reinterpret history",
    });
  }

  if (data.parentId) {
    if (data.parentId === id) {
      throw ApiError.validation("An account cannot be its own parent", { parentId: ["Choose another account"] });
    }

    const parent = await prisma.account.findUnique({
      where: { id: data.parentId },
      select: { id: true, type: true, parentId: true, code: true, name: true },
    });
    if (!parent) throw ApiError.validation("Parent account not found", { parentId: ["No such account"] });
    if (parent.type !== (data.type ?? account.type)) {
      throw ApiError.validation(`${parent.code} ${parent.name} is ${parent.type.toLowerCase()}`, {
        parentId: ["A child account has to be the same type as its parent"],
      });
    }

    // Walk up: a cycle makes the tree render for ever.
    let cursor = parent.parentId;
    const seen = new Set([id, parent.id]);
    while (cursor) {
      if (seen.has(cursor)) {
        throw ApiError.validation("That would make a loop in the chart", { parentId: ["Choose another parent"] });
      }
      seen.add(cursor);
      const next = await prisma.account.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = next?.parentId ?? null;
    }
  }

  const updated = await prisma.account.update({
    where: { id },
    data: {
      ...(data.code != null ? { code: data.code } : {}),
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.type != null ? { type: data.type } : {}),
      ...(data.subType !== undefined ? { subType: data.subType } : {}),
      ...(data.normalBalance != null ? { normalBalance: data.normalBalance } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.currency != null ? { currency: data.currency } : {}),
    },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "account.update",
    entityType: "Account",
    entityId: id,
    changes: { code: updated.code, name: updated.name },
  });

  return shape(updated);
}

/**
 * Deactivates an account.
 *
 * Never a delete. A posted line points at it for ever, and a required account —
 * one a posting rule resolves by code — cannot be deactivated at all, because
 * the next sale would fail to post with no way for anybody to see why.
 */
export async function setAccountActive(id, isActive, actor = null) {
  const account = await loadAccount(id);

  if (!isActive && REQUIRED_CODES.includes(account.code)) {
    throw ApiError.conflict(`${account.code} ${account.name} is used by the posting rules`, {
      hint: "Deactivating it would stop business events from reaching the ledger",
    });
  }

  if (!isActive) {
    const children = await prisma.account.count({ where: { parentId: id, isActive: true } });
    if (children > 0) {
      throw ApiError.conflict("This account still has active children", { children });
    }
  }

  const updated = await prisma.account.update({ where: { id }, data: { isActive }, select: SELECT });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: isActive ? "account.activate" : "account.deactivate",
    entityType: "Account",
    entityId: id,
    changes: { code: account.code, name: account.name },
  });

  return shape(updated);
}

/**
 * One account's balance and its movements.
 *
 * The drill-down behind every figure in a statement: a number in a report is
 * only trustworthy if you can click it and see the entries that make it up.
 */
export async function accountLedger({ id, from = null, to = null, limit = 100 }) {
  const account = await loadAccount(id);

  const window =
    from || to
      ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {};

  const [aggregate, opening, lines] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { accountId: id, entry: { status: "POSTED", ...window } },
      _sum: { debit: true, credit: true },
    }),
    from
      ? prisma.journalLine.aggregate({
          where: { accountId: id, entry: { status: "POSTED", entryDate: { lt: new Date(from) } } },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve({ _sum: { debit: 0, credit: 0 } }),
    prisma.journalLine.findMany({
      where: { accountId: id, entry: { status: "POSTED", ...window } },
      select: {
        id: true,
        debit: true,
        credit: true,
        description: true,
        partyType: true,
        partyId: true,
        entry: {
          select: { id: true, entryNumber: true, entryDate: true, source: true, memo: true, branchId: true },
        },
      },
      orderBy: { entry: { entryDate: "asc" } },
      take: limit,
    }),
  ]);

  const openingBalance = accountBalance({
    normalBalance: account.normalBalance,
    debit: opening._sum.debit ?? 0,
    credit: opening._sum.credit ?? 0,
  });

  // A running balance, so the drill-down reads like a bank statement.
  let running = D(openingBalance);
  const movements = lines.map((line) => {
    const movement =
      account.normalBalance === "DEBIT"
        ? D(line.debit).minus(D(line.credit))
        : D(line.credit).minus(D(line.debit));
    running = running.plus(movement);

    return {
      lineId: line.id,
      entryId: line.entry.id,
      entryNumber: line.entry.entryNumber,
      entryDate: line.entry.entryDate,
      source: line.entry.source,
      memo: line.entry.memo,
      description: line.description,
      partyType: line.partyType,
      partyId: line.partyId,
      debit: money(line.debit),
      credit: money(line.credit),
      balance: money(running),
    };
  });

  return {
    account: shape(account),
    openingBalance,
    debit: money(aggregate._sum.debit ?? 0),
    credit: money(aggregate._sum.credit ?? 0),
    closingBalance: accountBalance({
      normalBalance: account.normalBalance,
      debit: D(opening._sum.debit ?? 0).plus(D(aggregate._sum.debit ?? 0)),
      credit: D(opening._sum.credit ?? 0).plus(D(aggregate._sum.credit ?? 0)),
    }),
    movements,
    from,
    to,
  };
}

/**
 * Checks the chart can actually support the posting rules.
 *
 * Run after a seed or a chart edit. Every code the rules reference has to exist
 * and be active, and a missing one is found here rather than at the moment a
 * sale tries to post.
 */
export async function verifyChart() {
  const accounts = await prisma.account.findMany({
    where: { code: { in: REQUIRED_CODES } },
    select: { code: true, name: true, isActive: true },
  });

  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const missing = REQUIRED_CODES.filter((code) => !byCode.has(code));
  const inactive = accounts.filter((account) => !account.isActive).map((account) => account.code);

  return {
    required: REQUIRED_CODES.length,
    present: accounts.length,
    missing,
    inactive,
    healthy: missing.length === 0 && inactive.length === 0,
  };
}
