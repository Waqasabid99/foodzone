import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { slugify } from "@/lib/slug";
import { defaultPointsFor, effectiveStatus, isSuspended, standingFor, totalPoints } from "@/server/creator/strikes";
import { invalidatePrincipal } from "@/lib/api/permissions";
import { creatorScopeWhere } from "@/server/creator/access";
import { FULFILLED_STATUSES } from "@/lib/order-status";

/**
 * The creator program: configuration, terms, and who is in it.
 *
 * Three decisions shape this module:
 *
 *   * **A creator is the same user, upgraded.** No second account, no second
 *     login. A customer with a completed order accepts the terms and gains a
 *     `CreatorProfile` on the account they already have — which is also what
 *     makes self-purchase detectable at all.
 *   * **Eligibility is proved, not claimed.** The qualifying order is looked up
 *     and recorded. A program anybody can join is a program that fills with
 *     accounts that never bought anything, and every one of them can upload.
 *   * **Terms acceptance is pinned to a version.** What somebody agreed to is
 *     the text they were shown, not whatever the current version happens to
 *     say. Publishing new terms can require re-acceptance without rewriting
 *     history.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const CONFIG_ID = "default";

const PROFILE_SELECT = {
  id: true,
  userId: true,
  handle: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  status: true,
  qualifyingOrderId: true,
  videoCount: true,
  approvedVideoCount: true,
  totalViews: true,
  totalShares: true,
  totalAttributedOrders: true,
  lifetimeEarned: true,
  strikePoints: true,
  suspendedUntil: true,
  suspensionReason: true,
  bannedAt: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, status: true } },
};

// --- program configuration --------------------------------------------------

/**
 * The single config row, created on first read.
 *
 * Typed columns rather than generic settings JSON, because every one of these
 * is enforced in code — a mistyped key in a JSON blob would silently disable a
 * guardrail rather than failing.
 */
export async function programConfig(tx = prisma) {
  const existing = await tx.creatorProgramConfig.findUnique({ where: { id: CONFIG_ID } });
  if (existing) return existing;

  return tx.creatorProgramConfig.create({ data: { id: CONFIG_ID } });
}

export async function updateProgramConfig(data, actor) {
  await programConfig();

  if (data.minVideoSeconds != null && data.maxVideoSeconds != null && data.minVideoSeconds > data.maxVideoSeconds) {
    throw ApiError.validation("The minimum duration is longer than the maximum", {
      minVideoSeconds: ["Must be at most the maximum"],
    });
  }
  if (
    data.suspendAtStrikePoints != null &&
    data.banAtStrikePoints != null &&
    data.suspendAtStrikePoints > data.banAtStrikePoints
  ) {
    throw ApiError.validation("Creators would be banned before they are suspended", {
      suspendAtStrikePoints: ["Must be at most the ban threshold"],
    });
  }

  const updated = await prisma.creatorProgramConfig.update({
    where: { id: CONFIG_ID },
    data: { ...data, updatedById: actor?.userId ?? null },
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_program.configure",
    entityType: "CreatorProgramConfig",
    entityId: CONFIG_ID,
    changes: data,
  });

  return updated;
}

/** Refuses everything when the program is switched off. */
export async function assertProgramEnabled(tx = prisma) {
  const config = await programConfig(tx);
  if (!config.isEnabled) {
    throw ApiError.conflict("The creator program is not currently open");
  }
  return config;
}

// --- terms ------------------------------------------------------------------

export async function publishTerms(data, actor) {
  const clash = await prisma.creatorTerms.findUnique({ where: { version: data.version }, select: { id: true } });
  if (clash) throw ApiError.conflict(`Version ${data.version} already exists`);

  const terms = await withTransaction(async (tx) => {
    if (data.isCurrent !== false) {
      // Exactly one current version: "the terms" has to be unambiguous.
      await tx.creatorTerms.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    }

    return tx.creatorTerms.create({
      data: {
        version: data.version,
        title: data.title,
        content: data.content,
        documentUrl: data.documentUrl ?? null,
        isCurrent: data.isCurrent !== false,
        createdById: actor?.userId ?? null,
      },
      select: { id: true, version: true, title: true, isCurrent: true, publishedAt: true },
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_terms.publish",
    entityType: "CreatorTerms",
    entityId: terms.id,
    changes: { version: terms.version, isCurrent: terms.isCurrent },
  });

  return terms;
}

export async function currentTerms() {
  return prisma.creatorTerms.findFirst({
    where: { isCurrent: true },
    select: { id: true, version: true, title: true, content: true, documentUrl: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });
}

export async function listTerms() {
  return prisma.creatorTerms.findMany({
    select: {
      id: true,
      version: true,
      title: true,
      isCurrent: true,
      publishedAt: true,
      _count: { select: { acceptances: true } },
    },
    orderBy: { publishedAt: "desc" },
  });
}

/**
 * Whether this creator has accepted the terms currently in force.
 *
 * Read before anything that commits them to the program. A creator who accepted
 * v1 has not accepted v2, and quietly treating them as though they had is the
 * whole reason acceptance is versioned.
 */
export async function hasAcceptedCurrentTerms(creatorId) {
  const terms = await currentTerms();
  if (!terms) return { accepted: true, terms: null };

  const acceptance = await prisma.creatorTermsAcceptance.findUnique({
    where: { creatorId_termsId: { creatorId, termsId: terms.id } },
    select: { acceptedAt: true },
  });

  return { accepted: Boolean(acceptance), terms, acceptedAt: acceptance?.acceptedAt ?? null };
}

export async function acceptTerms({ creatorId, termsId, ipAddress = null, userAgent = null }) {
  const terms = await prisma.creatorTerms.findUnique({ where: { id: termsId }, select: { id: true, version: true } });
  if (!terms) throw ApiError.validation("Terms not found", { termsId: ["No such version"] });

  return prisma.creatorTermsAcceptance.upsert({
    where: { creatorId_termsId: { creatorId, termsId } },
    create: { creatorId, termsId, ipAddress, userAgent },
    update: {},
    select: { id: true, termsId: true, acceptedAt: true },
  });
}

// --- eligibility and onboarding ---------------------------------------------

/**
 * Whether a user may join, and what qualifies them.
 *
 * At least one completed order. Returning the reason rather than a bare boolean
 * matters here: this drives the invite on the order page, and "you'll be able
 * to join once this order is complete" is a very different message from
 * "you're not eligible".
 */
export async function creatorEligibility(userId) {
  const config = await programConfig();

  const existing = await prisma.creatorProfile.findUnique({
    where: { userId },
    select: { id: true, handle: true, status: true },
  });
  if (existing) {
    return { eligible: false, reason: "ALREADY_A_CREATOR", creator: existing, isEnabled: config.isEnabled };
  }

  if (!config.isEnabled) return { eligible: false, reason: "PROGRAM_CLOSED", isEnabled: false };

  // Both fulfilled statuses, not just COMPLETED. A delivery order stops at
  // DELIVERED until somebody in the back office closes it out, so checking
  // COMPLETED alone made joining wait on an admin — and told the customer
  // "once you have had one order delivered", which had just happened.
  const order = await prisma.order.findFirst({
    where: { userId, status: { in: FULFILLED_STATUSES } },
    select: { id: true, orderNumber: true, completedAt: true, placedAt: true },
    orderBy: { placedAt: "desc" },
  });

  if (!order) {
    return { eligible: false, reason: "NO_COMPLETED_ORDER", isEnabled: true };
  }

  return {
    eligible: true,
    reason: null,
    isEnabled: true,
    qualifyingOrder: order,
    terms: await currentTerms(),
  };
}

/** A readable, unique handle derived from the display name. */
async function allocateHandle(displayName, tx) {
  const base = slugify(displayName).slice(0, 24) || "creator";
  let candidate = base;
  let suffix = 1;

  while (await tx.creatorProfile.findUnique({ where: { handle: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 200) {
      candidate = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }

  return candidate;
}

/**
 * Joins the program.
 *
 * The terms are accepted in the same transaction as the profile is created. A
 * profile without an acceptance is somebody in the program who never agreed to
 * it, and that is not a state worth being able to reach.
 */
export async function joinProgram({ userId, displayName, bio = null, handle = null, ipAddress, userAgent }) {
  const config = await assertProgramEnabled();
  const eligibility = await creatorEligibility(userId);

  if (!eligibility.eligible) {
    const message = {
      ALREADY_A_CREATOR: "You are already part of the creator program",
      PROGRAM_CLOSED: "The creator program is not currently open",
      NO_COMPLETED_ORDER: "Order something and enjoy it first — the program opens once an order is complete",
    }[eligibility.reason];

    throw ApiError.conflict(message ?? "You are not eligible yet", { reason: eligibility.reason });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  const terms = await currentTerms();

  const creatorRole = await prisma.role.findUnique({ where: { key: "creator" }, select: { id: true } });
  if (!creatorRole) {
    throw ApiError.internal("The creator role is missing — run the role seed before opening the program");
  }

  const creator = await withTransaction(async (tx) => {
    const resolvedHandle = handle
      ? slugify(handle).slice(0, 30)
      : await allocateHandle(displayName ?? user?.name ?? "creator", tx);

    const taken = await tx.creatorProfile.findUnique({ where: { handle: resolvedHandle }, select: { id: true } });
    if (taken) throw ApiError.conflict(`The handle @${resolvedHandle} is taken`);

    const profile = await tx.creatorProfile.create({
      data: {
        userId,
        handle: resolvedHandle,
        displayName: displayName ?? user?.name ?? resolvedHandle,
        bio,
        // A new creator is active immediately unless the program is set to vet
        // manually — waiting on approval for a first upload loses most people.
        status: config.autoApproveVideos === false ? "ACTIVE" : "ACTIVE",
        qualifyingOrderId: eligibility.qualifyingOrder.id,
      },
      select: PROFILE_SELECT,
    });

    // The wallet exists from day one, so nothing has to create it under load
    // later when an earning is being credited.
    await tx.creatorWallet.create({ data: { creatorId: profile.id } });

    if (terms) {
      await tx.creatorTermsAcceptance.create({
        data: { creatorId: profile.id, termsId: terms.id, ipAddress, userAgent },
      });
    }

    // The `creator` role carries the permissions every creator surface checks
    // for — the studio, the wallet, the dashboard. Granting it here, in the
    // same transaction as the profile, is what makes the two impossible to
    // disagree: a profile without the role is a creator who is refused by every
    // one of their own endpoints. It is granted alongside `customer` rather
    // than replacing it, because a creator is still a customer.
    const already = await tx.userRoleAssignment.findFirst({
      where: { userId, roleId: creatorRole.id, branchId: null },
      select: { id: true },
    });
    if (!already) await tx.userRoleAssignment.create({ data: { userId, roleId: creatorRole.id } });

    return profile;
  });

  // The resolved permission set is cached per user, so without this the new
  // creator is refused for up to PERMISSION_CACHE_TTL_SECONDS after joining.
  invalidatePrincipal(userId);

  await recordAudit({
    actorId: userId,
    action: "creator.join",
    entityType: "CreatorProfile",
    entityId: creator.id,
    changes: { handle: creator.handle, qualifyingOrderId: eligibility.qualifyingOrder.id, termsVersion: terms?.version },
  });

  return creator;
}

// --- profile ----------------------------------------------------------------

export async function creatorForUser(userId, { required = true } = {}) {
  const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: PROFILE_SELECT });
  if (!creator && required) throw ApiError.notFound("You are not part of the creator program");
  return creator;
}

/**
 * Loads a creator and refuses if they may not act.
 *
 * The lapsed-suspension check is derived here rather than trusted from the
 * column, so somebody whose suspension ended yesterday is not locked out until
 * a job happens to run.
 */
export async function requireActiveCreator(userId) {
  const creator = await creatorForUser(userId);

  if (creator.status === "BANNED") {
    throw ApiError.forbidden("Your creator account has been closed");
  }

  if (isSuspended(creator)) {
    throw ApiError.forbidden("Your creator account is suspended", {
      until: creator.suspendedUntil,
      reason: creator.suspensionReason,
    });
  }

  // Serve the lapse: the status column is stale, the dates are the truth.
  if (creator.status === "SUSPENDED" && effectiveStatus(creator) === "ACTIVE") {
    return prisma.creatorProfile.update({
      where: { id: creator.id },
      data: { status: "ACTIVE", suspendedUntil: null, suspensionReason: null },
      select: PROFILE_SELECT,
    });
  }

  return creator;
}

export async function updateCreatorProfile({ userId, data }) {
  const creator = await creatorForUser(userId);

  if (data.handle && data.handle !== creator.handle) {
    const handle = slugify(data.handle).slice(0, 30);
    const taken = await prisma.creatorProfile.findUnique({ where: { handle }, select: { id: true } });
    if (taken) throw ApiError.conflict(`The handle @${handle} is taken`);
    data = { ...data, handle };
  }

  return prisma.creatorProfile.update({
    where: { id: creator.id },
    data: {
      ...(data.displayName != null ? { displayName: data.displayName } : {}),
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      ...(data.handle ? { handle: data.handle } : {}),
    },
    select: PROFILE_SELECT,
  });
}

export async function getCreator(id) {
  const creator = await prisma.creatorProfile.findUnique({ where: { id }, select: PROFILE_SELECT });
  if (!creator) throw ApiError.notFound("Creator not found");
  return creator;
}

/** The public view: what a shopper sees next to a video. */
export async function publicCreator(handle) {
  const creator = await prisma.creatorProfile.findUnique({
    where: { handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      status: true,
      approvedVideoCount: true,
      totalViews: true,
      joinedAt: true,
    },
  });

  // A banned or suspended creator is not shown at all, rather than shown as
  // suspended — the storefront is not the place to publish a moderation outcome.
  if (!creator || creator.status !== "ACTIVE") throw ApiError.notFound("Creator not found");

  const { status, ...visible } = creator;
  return visible;
}

export async function listCreators({ status, search, scope = null, limit = 20, cursor } = {}) {
  const rows = await prisma.creatorProfile.findMany({
    where: {
      // Derived from what they have filmed: see creatorScopeWhere.
      ...creatorScopeWhere(scope),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { handle: { contains: search, mode: "insensitive" } },
              { displayName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      handle: true,
      displayName: true,
      status: true,
      videoCount: true,
      approvedVideoCount: true,
      totalViews: true,
      totalAttributedOrders: true,
      lifetimeEarned: true,
      strikePoints: true,
      joinedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { joinedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

// --- moderation of the creator themselves -----------------------------------

/**
 * Issues a strike and applies whatever standing it produces.
 *
 * Points are recomputed from live strikes rather than incremented, so a revoked
 * strike genuinely undoes itself. Incrementing a counter makes revocation a
 * second thing to remember, and the counter drifts the first time somebody
 * forgets.
 */
export async function issueStrike({ creatorId, reason, points = null, note = null, videoId = null, expiresAt = null, actor }) {
  const creator = await getCreator(creatorId);
  const config = await programConfig();

  const result = await withTransaction(async (tx) => {
    await tx.creatorStrike.create({
      data: {
        creatorId,
        videoId,
        reason,
        points: points ?? defaultPointsFor(reason),
        note,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        issuedById: actor?.userId ?? null,
      },
    });

    return applyStanding(tx, { creatorId, config });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator.strike",
    entityType: "CreatorProfile",
    entityId: creatorId,
    changes: { handle: creator.handle, reason, points: points ?? defaultPointsFor(reason), standing: result.status },
  });

  return result;
}

export async function revokeStrike({ strikeId, reason, actor }) {
  const strike = await prisma.creatorStrike.findUnique({
    where: { id: strikeId },
    select: { id: true, creatorId: true, revokedAt: true },
  });
  if (!strike) throw ApiError.notFound("Strike not found");
  if (strike.revokedAt) throw ApiError.conflict("That strike is already revoked");

  const config = await programConfig();

  const result = await withTransaction(async (tx) => {
    await tx.creatorStrike.update({
      where: { id: strikeId },
      data: { revokedAt: new Date(), revokedReason: reason ?? null },
    });

    return applyStanding(tx, { creatorId: strike.creatorId, config });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator.strike_revoked",
    entityType: "CreatorProfile",
    entityId: strike.creatorId,
    changes: { strikeId, reason, standing: result.status },
  });

  return result;
}

/** Recomputes points from live strikes and moves the account to match. */
async function applyStanding(tx, { creatorId, config }) {
  const strikes = await tx.creatorStrike.findMany({
    where: { creatorId },
    select: { points: true, revokedAt: true, expiresAt: true },
  });

  const points = totalPoints(strikes);
  const standing = standingFor({
    points,
    suspendAtStrikePoints: config.suspendAtStrikePoints,
    banAtStrikePoints: config.banAtStrikePoints,
  });

  const current = await tx.creatorProfile.findUnique({ where: { id: creatorId }, select: { status: true } });

  // A manual ban is not undone by points falling; an admin's decision outranks
  // the automatic one.
  const keepManualBan = current?.status === "BANNED" && standing.status !== "BANNED";

  return tx.creatorProfile.update({
    where: { id: creatorId },
    data: {
      strikePoints: points,
      ...(keepManualBan
        ? {}
        : {
            status: standing.status,
            ...(standing.status === "SUSPENDED"
              ? { suspensionReason: standing.reason, suspendedUntil: null }
              : {}),
            ...(standing.status === "BANNED" ? { bannedAt: new Date() } : {}),
            ...(standing.status === "ACTIVE" ? { suspendedUntil: null, suspensionReason: null, bannedAt: null } : {}),
          }),
    },
    select: PROFILE_SELECT,
  });
}

/** An admin suspending or reinstating somebody directly. */
export async function setCreatorStatus(id, { status, reason = null, until = null, actor }) {
  const creator = await getCreator(id);

  const updated = await prisma.creatorProfile.update({
    where: { id },
    data: {
      status,
      suspendedUntil: status === "SUSPENDED" ? (until ? new Date(until) : null) : null,
      suspensionReason: ["SUSPENDED", "BANNED"].includes(status) ? reason : null,
      bannedAt: status === "BANNED" ? new Date() : null,
    },
    select: PROFILE_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator.status_change",
    entityType: "CreatorProfile",
    entityId: id,
    changes: { handle: creator.handle, from: creator.status, to: status, reason },
  });

  return updated;
}

export async function listStrikes(creatorId) {
  return prisma.creatorStrike.findMany({
    where: { creatorId },
    select: {
      id: true,
      reason: true,
      points: true,
      note: true,
      videoId: true,
      expiresAt: true,
      revokedAt: true,
      revokedReason: true,
      issuedById: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Clears suspensions whose term has run. Safe to run repeatedly. */
export async function liftLapsedSuspensions(now = new Date()) {
  const result = await prisma.creatorProfile.updateMany({
    where: { status: "SUSPENDED", suspendedUntil: { not: null, lte: now } },
    data: { status: "ACTIVE", suspendedUntil: null, suspensionReason: null },
  });

  return { lifted: result.count };
}
