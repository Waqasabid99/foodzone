import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/access/scope";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { money } from "@/server/pricing/engine";
import { enqueue } from "@/server/jobs/outbox";

/**
 * Cash registers.
 *
 * A till session is the answer to "was any money missing today", and it only
 * works if the expected figure is computed by the system and the counted figure
 * is typed in by a human who cannot see it first. That is why closing takes
 * `countedCash` as input and returns the variance, rather than showing the
 * expected total and asking someone to confirm it — a cashier who is shown the
 * answer will reconcile to the answer, and the control is worth nothing.
 *
 * Everything that touches the drawer becomes a `CashMovement`, signed: sales
 * and pay-ins positive, refunds, pay-outs and drops negative. The expected cash
 * is then the opening float plus the sum of movements, which means it is
 * derived from rows rather than maintained as a running total that can drift.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  branchId: true,
  registerName: true,
  openedById: true,
  closedById: true,
  status: true,
  openingFloat: true,
  expectedCash: true,
  countedCash: true,
  variance: true,
  notes: true,
  openedAt: true,
  closedAt: true,
};

/**
 * Opens a session.
 *
 * One open session per register per branch: two people taking cash into the
 * same named drawer makes the variance meaningless, because neither is
 * accountable for it.
 */
export async function openSession({ branchId, registerName = "main", openingFloat = 0, notes = null, actor }) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, isActive: true } });
  if (!branch) throw ApiError.notFound("Branch not found");

  const existing = await prisma.cashRegisterSession.findFirst({
    where: { branchId, registerName, status: "OPEN" },
    select: { id: true, openedById: true, openedAt: true },
  });
  if (existing) {
    throw ApiError.conflict(`Register "${registerName}" already has an open session. Close it first.`, {
      sessionId: existing.id,
      openedAt: existing.openedAt,
    });
  }

  const session = await prisma.cashRegisterSession.create({
    data: {
      branchId,
      registerName,
      openingFloat: money(openingFloat),
      openedById: actor.userId,
      status: "OPEN",
      ...(notes ? { notes } : {}),
    },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    branchId,
    action: "register.open",
    entityType: "CashRegisterSession",
    entityId: session.id,
    changes: { registerName, openingFloat: Number(session.openingFloat) },
  });

  return session;
}

/** Opening float plus every movement since — derived, never a stored running total. */
export async function expectedCashFor(sessionId, tx = prisma) {
  const session = await tx.cashRegisterSession.findUnique({
    where: { id: sessionId },
    select: { openingFloat: true },
  });
  if (!session) throw ApiError.notFound("Register session not found");

  const movements = await tx.cashMovement.aggregate({ where: { sessionId }, _sum: { amount: true } });

  return money(D(session.openingFloat).plus(D(movements._sum.amount)));
}

export async function recordMovement({ sessionId, type, amount, reason = null, referenceType = null, referenceId = null, actor }) {
  const session = await prisma.cashRegisterSession.findUnique({
    where: { id: sessionId },
    select: { id: true, branchId: true, status: true },
  });
  if (!session) throw ApiError.notFound("Register session not found");
  if (session.status !== "OPEN") throw ApiError.conflict("That register session is closed");

  // The sign is decided here, from the movement type, rather than trusted from
  // the request. A pay-out sent as a positive number would otherwise inflate the
  // drawer and hide a shortfall.
  const magnitude = D(amount).abs();
  const outgoing = ["PAY_OUT", "DROP", "TIP_OUT", "REFUND"].includes(type);
  const signed = outgoing ? magnitude.negated() : magnitude;

  if (magnitude.lessThanOrEqualTo(0)) {
    throw ApiError.validation("A movement must be more than zero", { amount: ["Must be greater than zero"] });
  }
  if (type === "ADJUSTMENT" && !reason?.trim()) {
    // An adjustment is the one type with no external cause, so it has to carry
    // its justification or it is indistinguishable from covering a shortfall.
    throw ApiError.validation("An adjustment needs a reason", { reason: ["Required"] });
  }

  const movement = await prisma.cashMovement.create({
    data: {
      sessionId,
      type,
      amount: money(signed),
      reason: reason?.trim() ?? null,
      referenceType,
      referenceId,
      performedById: actor?.userId ?? null,
    },
    select: {
      id: true,
      sessionId: true,
      type: true,
      amount: true,
      reason: true,
      referenceType: true,
      referenceId: true,
      performedById: true,
      createdAt: true,
    },
  });

  if (["PAY_OUT", "ADJUSTMENT", "DROP"].includes(type)) {
    await recordAudit({
      actorId: actor?.userId ?? null,
      branchId: session.branchId,
      action: `register.${type.toLowerCase()}`,
      entityType: "CashMovement",
      entityId: movement.id,
      changes: { amount: Number(movement.amount), reason: movement.reason },
    });
  }

  return movement;
}

/**
 * Closes a session against a physical count.
 *
 * `countedCash` is required — closing without one would leave a session with no
 * variance, which is the same as not having counted.
 */
export async function closeSession({ sessionId, countedCash, notes = null, actor }) {
  const session = await prisma.cashRegisterSession.findUnique({ where: { id: sessionId }, select: SELECT });
  if (!session) throw ApiError.notFound("Register session not found");
  if (session.status !== "OPEN") throw ApiError.conflict("That session is already closed", { status: session.status });

  if (countedCash == null) {
    throw ApiError.validation("Count the drawer before closing it", { countedCash: ["Required"] });
  }

  const closed = await withTransaction(async (tx) => {
    const expected = await expectedCashFor(sessionId, tx);
    const counted = money(countedCash);
    // Positive is over, negative is short — the direction a manager expects.
    const variance = money(D(counted).minus(D(expected)));

    // A till that did not count out is cash over/short in the ledger. Enqueued
    // even when the variance is zero — the posting rule decides that, not the
    // caller, and a rule that is never invoked is a rule nobody notices broke.
    await enqueue({ eventType: "finance.cash_session_closed", payload: { sessionId }, db: tx });

    return tx.cashRegisterSession.update({
      where: { id: sessionId },
      data: {
        status: "CLOSED",
        closedById: actor.userId,
        closedAt: new Date(),
        expectedCash: expected,
        countedCash: counted,
        variance,
        notes,
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: session.branchId,
    action: "register.close",
    entityType: "CashRegisterSession",
    entityId: sessionId,
    changes: {
      expectedCash: Number(closed.expectedCash),
      countedCash: Number(closed.countedCash),
      variance: Number(closed.variance),
      notes,
    },
  });

  return closed;
}

/**
 * Signs off a closed session's variance.
 *
 * Separate from closing, and a separate permission: the cashier counts, a
 * manager accepts. Without that split the person who is short is the person who
 * signs off being short.
 */
export async function reconcileSession({ sessionId, notes = null, actor }) {
  const session = await prisma.cashRegisterSession.findUnique({ where: { id: sessionId }, select: SELECT });
  if (!session) throw ApiError.notFound("Register session not found");

  if (session.status === "OPEN") throw ApiError.conflict("Close the session before reconciling it");
  if (session.status === "RECONCILED") return session;

  const reconciled = await prisma.cashRegisterSession.update({
    where: { id: sessionId },
    data: { status: "RECONCILED", notes: notes ?? session.notes },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: session.branchId,
    action: "register.reconcile",
    entityType: "CashRegisterSession",
    entityId: sessionId,
    changes: { variance: Number(session.variance ?? 0), notes },
  });

  return reconciled;
}

// --- reads ------------------------------------------------------------------

export async function listSessions({ branchId, status, scope = null, limit = 20, cursor } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.cashRegisterSession.findMany({
    where: {
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(branchId ? { branchId } : {}),
      ...(status ? { status } : {}),
    },
    select: { ...SELECT, _count: { select: { payments: true, movements: true } } },
    orderBy: { openedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...row }) => ({
      ...row,
      paymentCount: _count.payments,
      movementCount: _count.movements,
    })),
  };
}

/**
 * One session in full, with the running expected figure.
 *
 * While the session is open this is what the drawer *should* hold right now,
 * which is what a mid-shift drop is decided from.
 */
export async function getSession(id) {
  const session = await prisma.cashRegisterSession.findUnique({
    where: { id },
    select: {
      ...SELECT,
      movements: {
        select: {
          id: true,
          type: true,
          amount: true,
          reason: true,
          referenceType: true,
          referenceId: true,
          performedById: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!session) throw ApiError.notFound("Register session not found");

  const byType = {};
  for (const movement of session.movements) {
    byType[movement.type] = money(D(byType[movement.type]).plus(D(movement.amount)));
  }

  return {
    ...session,
    expectedCash: session.status === "OPEN" ? await expectedCashFor(id) : session.expectedCash,
    totalsByType: byType,
  };
}

/** The open session for a branch, if there is one — what a POS asks on load. */
export async function openSessionFor({ branchId, registerName = null, userId = null }) {
  return prisma.cashRegisterSession.findFirst({
    where: {
      branchId,
      status: "OPEN",
      ...(registerName ? { registerName } : {}),
      ...(userId ? { openedById: userId } : {}),
    },
    select: SELECT,
    orderBy: { openedAt: "desc" },
  });
}
