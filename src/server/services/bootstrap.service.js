import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { hashPassword } from "@/server/utils/password";
import { logger } from "@/lib/logger";

/**
 * Turning a deployed installation into a usable one.
 *
 * `db:seed` leaves a system with permissions, roles, a chart of accounts, a
 * fiscal calendar and public pages — and **nobody who can sign in**. This is
 * the step that closes that gap, and it is deliberately the only part of the
 * system that creates an account without an account behind it.
 *
 * That makes it the one genuinely dangerous endpoint here, so it has three
 * independent guards and fails closed on each:
 *
 *   1. **Only while the system is unclaimed.** Zero users, or it refuses. Once
 *      an owner exists this cannot run a second time, whatever else is wrong.
 *   2. **Only with the token** from `SETUP_TOKEN`, which the operator sets
 *      alongside the other secrets. A missing variable refuses everything
 *      rather than waving traffic through — a deployment where somebody forgot
 *      it is exactly the one worth protecting.
 *   3. **Rate limited**, at the route.
 *
 * The owner is created with `isSuperAdmin`, which the permission layer treats
 * as a bypass and documents as "bootstrap account only". That is precisely
 * this account. Day-to-day staff should be given roles instead.
 */

/**
 * Whether this installation still needs setting up.
 *
 * Any user at all counts, not just an owner: a system with customers in it has
 * been in use, and "unclaimed" has to mean untouched or it is not a guard.
 */
export async function installationNeedsSetup(db = prisma) {
  return (await db.user.count()) === 0;
}

/**
 * Compares the supplied token against `SETUP_TOKEN`.
 *
 * Constant-time, and length-aware: `timingSafeEqual` throws on mismatched
 * lengths, so the lengths are compared first — which does leak the token's
 * length, and that is a fair trade for not leaking its contents.
 *
 * Returns false when no token is configured. Every other check in this file
 * can be satisfied by an attacker who arrives first; this one cannot, so it is
 * the one that must never default to open.
 */
export function setupTokenMatches(provided, expected = process.env.SETUP_TOKEN) {
  const want = typeof expected === "string" ? expected.trim() : "";
  if (!want) return false;
  if (typeof provided !== "string" || provided.length !== want.length) return false;

  return timingSafeEqual(Buffer.from(provided), Buffer.from(want));
}

/**
 * Creates the owner and the first branch, in one transaction.
 *
 * One transaction because half a setup is worse than none: an owner with no
 * branch cannot create orders, and a branch with no owner cannot be reached at
 * all, and both leave an installation that now refuses to be set up again
 * because it is no longer empty.
 */
export async function bootstrapInstallation({ owner, branch }) {
  if (!(await installationNeedsSetup())) {
    throw ApiError.conflict("This installation has already been set up", {
      hint: "Sign in instead, or reset the database if this was meant to be a fresh install",
    });
  }

  const result = await withTransaction(async (tx) => {
    // Re-checked inside the transaction. Two setup requests arriving together
    // would both pass the check above; this is the one that holds.
    if (!(await installationNeedsSetup(tx))) {
      throw ApiError.conflict("This installation has already been set up");
    }

    const user = await tx.user.create({
      data: {
        name: owner.name,
        email: owner.email.toLowerCase(),
        passwordHash: await hashPassword(owner.password),
        status: "ACTIVE",
        // The owner sets their own password on this form, so there is nobody
        // to send a verification code to and nothing it would prove.
        emailVerifiedAt: new Date(),
        isSuperAdmin: true,
      },
      select: { id: true, name: true, email: true },
    });

    const created = await tx.branch.create({
      data: {
        code: branch.code,
        name: branch.name,
        city: branch.city ?? null,
        phone: branch.phone ?? null,
        timezone: branch.timezone,
        currency: branch.currency,
        isActive: true,
      },
      select: { id: true, code: true, name: true, timezone: true, currency: true },
    });

    return { owner: user, branch: created };
  });

  logger.info("installation set up", { ownerId: result.owner.id, branchId: result.branch.id });

  return result;
}
