import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { money } from "@/server/accounting/balance";
import { startOfDay } from "@/server/attendance/shift";
import { attemptsRemaining } from "@/server/creator/strikes";
import { programConfig } from "@/server/services/creator.service";
import { walletFor } from "@/server/services/creator-wallet.service";
import { earningScopeWhere } from "@/server/creator/access";

/**
 * What a creator sees when they open the app.
 *
 * Deliberately built around the question they actually have — "is this worth my
 * time" — rather than around the tables. That means three things are always
 * present, even when they are zero:
 *
 *   * **Pending money**, so the hold window is visible rather than looking like
 *     the earning never happened;
 *   * **Sales that earned nothing**, because a video that drove a sale below
 *     the threshold did work, and hiding that reads as the program being
 *     broken;
 *   * **Appreciation**, which is the non-monetary half of the answer for the
 *     large majority of creators who will never earn much.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

export async function creatorDashboard({ userId }) {
  const creator = await prisma.creatorProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      status: true,
      suspendedUntil: true,
      videoCount: true,
      approvedVideoCount: true,
      totalViews: true,
      totalShares: true,
      totalAttributedOrders: true,
      lifetimeEarned: true,
      strikePoints: true,
      joinedAt: true,
    },
  });
  if (!creator) throw ApiError.notFound("You are not part of the creator program");

  const config = await programConfig();
  const wallet = await walletFor(creator.id);

  const [byStatus, videos, pendingEarnings, recentEarnings, unseenAppreciation] = await Promise.all([
    prisma.creatorVideo.groupBy({
      by: ["status"],
      where: { creatorId: creator.id },
      _count: { _all: true },
    }),
    prisma.creatorVideo.findMany({
      where: { creatorId: creator.id, status: { in: ["APPROVED", "PENDING_REVIEW", "REJECTED", "DRAFT"] } },
      select: {
        id: true,
        status: true,
        caption: true,
        thumbnailUrl: true,
        viewCount: true,
        likeCount: true,
        shareCount: true,
        addToCartCount: true,
        attributedOrderCount: true,
        earnedTotal: true,
        rejectionCount: true,
        isLocked: true,
        lastRejectionReason: true,
        publishedAt: true,
        product: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.creatorEarning.aggregate({
      where: { creatorId: creator.id, status: { in: ["PENDING", "APPROVED"] } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.creatorEarning.findMany({
      where: { creatorId: creator.id },
      select: {
        id: true,
        status: true,
        amount: true,
        basisAmount: true,
        disqualifiedReason: true,
        availableAt: true,
        creditedAt: true,
        createdAt: true,
        ruleNameSnapshot: true,
        video: { select: { id: true, caption: true, thumbnailUrl: true } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.creatorAppreciation.count({ where: { creatorId: creator.id, seenAt: null } }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));

  return {
    creator,
    wallet: {
      balance: wallet.balance,
      pendingBalance: wallet.pendingBalance,
      lifetimeEarned: wallet.lifetimeEarned,
      lifetimeRedeemed: wallet.lifetimeRedeemed,
      isLocked: wallet.isLocked,
      currency: wallet.currency,
      minRedemptionAmount: config.minRedemptionAmount,
    },
    videos: {
      byStatus: statusCounts,
      total: creator.videoCount,
      live: statusCounts.APPROVED ?? 0,
      awaitingReview: statusCounts.PENDING_REVIEW ?? 0,
      needsAttention: (statusCounts.REJECTED ?? 0) + (statusCounts.DRAFT ?? 0),
      recent: videos.map((video) => ({
        ...video,
        attemptsRemaining: attemptsRemaining({
          rejectionCount: video.rejectionCount,
          maxUploadAttempts: config.maxUploadAttempts,
        }),
      })),
    },
    earnings: {
      pendingCount: pendingEarnings._count._all,
      pendingAmount: money(pendingEarnings._sum.amount ?? 0),
      holdDays: config.earningHoldDays,
      recent: recentEarnings,
    },
    unseenAppreciation,
  };
}

/**
 * Per-video performance, with the funnel that matters.
 *
 * Views alone say nothing about whether a video sells. The useful shape is
 * views → add-to-carts → orders, because a video with a thousand views and no
 * add-to-carts is a different problem from one with fifty views and ten.
 */
export async function videoPerformance({ userId, from, to }) {
  const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!creator) throw ApiError.notFound("You are not part of the creator program");

  const videos = await prisma.creatorVideo.findMany({
    where: { creatorId: creator.id, status: { in: ["APPROVED", "TAKEN_DOWN", "ARCHIVED"] } },
    select: {
      id: true,
      caption: true,
      thumbnailUrl: true,
      status: true,
      publishedAt: true,
      viewCount: true,
      uniqueViewerCount: true,
      completedViewCount: true,
      likeCount: true,
      shareCount: true,
      addToCartCount: true,
      attributedOrderCount: true,
      earnedTotal: true,
      product: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  const rows = videos.map((video) => {
    const views = Number(video.viewCount ?? 0);
    const carts = Number(video.addToCartCount ?? 0);
    const orders = Number(video.attributedOrderCount ?? 0);

    return {
      ...video,
      // Null rather than zero when there is nothing to divide by: a brand new
      // video has an unknown conversion rate, not a bad one.
      addToCartRate: views > 0 ? Number(((carts / views) * 100).toFixed(2)) : null,
      conversionRate: carts > 0 ? Number(((orders / carts) * 100).toFixed(2)) : null,
      completionRate: views > 0 ? Number(((Number(video.completedViewCount ?? 0) / views) * 100).toFixed(2)) : null,
    };
  });

  const daily = from
    ? await prisma.creatorVideoDailyStat.groupBy({
        by: ["statDate"],
        where: {
          video: { creatorId: creator.id },
          statDate: { gte: startOfDay(from), ...(to ? { lte: startOfDay(to) } : {}) },
        },
        _sum: { views: true, likes: true, shares: true, addToCarts: true, attributedOrders: true, earnings: true },
        orderBy: { statDate: "asc" },
      })
    : [];

  return {
    videos: rows,
    daily: daily.map((row) => ({ statDate: row.statDate, ...row._sum })),
    totals: {
      views: rows.reduce((sum, row) => sum + Number(row.viewCount ?? 0), 0),
      addToCarts: rows.reduce((sum, row) => sum + Number(row.addToCartCount ?? 0), 0),
      orders: rows.reduce((sum, row) => sum + Number(row.attributedOrderCount ?? 0), 0),
      earned: money(rows.reduce((sum, row) => sum.plus(D(row.earnedTotal)), D(0))),
    },
  };
}

// --- appreciation -----------------------------------------------------------

/**
 * Records recognition.
 *
 * Idempotent per (creator, type, video) for the one-off milestones, so a
 * re-delivered event does not congratulate somebody twice for the same thing —
 * which reads as a bug and cheapens the ones that are real.
 */
export async function recordAppreciation({ creatorId, videoId = null, orderId = null, type, title, message = null, metadata = null, once = true }) {
  if (once) {
    const existing = await prisma.creatorAppreciation.findFirst({
      where: { creatorId, type, ...(videoId ? { videoId } : {}), ...(orderId ? { orderId } : {}) },
      select: { id: true },
    });
    if (existing) return { skipped: true, id: existing.id };
  }

  return prisma.creatorAppreciation.create({
    data: { creatorId, videoId, orderId, type, title, message, metadata },
    select: { id: true, type: true, title: true, message: true, createdAt: true },
  });
}

export async function appreciationFeed({ userId, limit = 20, cursor }) {
  const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!creator) throw ApiError.notFound("You are not part of the creator program");

  const rows = await prisma.creatorAppreciation.findMany({
    where: { creatorId: creator.id },
    select: {
      id: true,
      type: true,
      title: true,
      message: true,
      metadata: true,
      seenAt: true,
      createdAt: true,
      video: { select: { id: true, caption: true, thumbnailUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function markAppreciationSeen({ userId, ids = null }) {
  const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!creator) throw ApiError.notFound("You are not part of the creator program");

  const result = await prisma.creatorAppreciation.updateMany({
    where: { creatorId: creator.id, seenAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { seenAt: new Date() },
  });

  return { marked: result.count };
}

/**
 * Milestone checks, run after engagement changes.
 *
 * Thresholds rather than continuous celebration: being told every hundred views
 * is noise, being told at a thousand is a moment.
 */
const VIEW_MILESTONES = [100, 1000, 10_000, 100_000];
const SHARE_MILESTONES = [10, 100, 1000];
const SALES_MILESTONES = [1, 10, 100];

export async function checkMilestones({ videoId }) {
  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, creatorId: true, viewCount: true, shareCount: true, attributedOrderCount: true, caption: true },
  });
  if (!video) return { awarded: 0 };

  const awarded = [];

  const crossed = (value, thresholds) => thresholds.filter((threshold) => Number(value ?? 0) >= threshold).pop();

  const views = crossed(video.viewCount, VIEW_MILESTONES);
  if (views) {
    const result = await recordAppreciation({
      creatorId: video.creatorId,
      videoId,
      type: "VIEW_MILESTONE",
      title: `${views.toLocaleString()} views`,
      message: "People are watching.",
      metadata: { metric: "views", threshold: views, actual: video.viewCount },
    });
    if (!result.skipped) awarded.push("VIEW_MILESTONE");
  }

  const shares = crossed(video.shareCount, SHARE_MILESTONES);
  if (shares) {
    const result = await recordAppreciation({
      creatorId: video.creatorId,
      videoId,
      type: "SHARE_MILESTONE",
      title: `${shares} shares`,
      message: "Your video is travelling.",
      metadata: { metric: "shares", threshold: shares, actual: video.shareCount },
    });
    if (!result.skipped) awarded.push("SHARE_MILESTONE");
  }

  const sales = crossed(video.attributedOrderCount, SALES_MILESTONES);
  if (sales) {
    const result = await recordAppreciation({
      creatorId: video.creatorId,
      videoId,
      type: sales === 1 ? "FIRST_SALE" : "SALES_MILESTONE",
      title: sales === 1 ? "Your video made its first sale" : `${sales} sales from this video`,
      message: sales === 1 ? "Somebody watched it and ordered." : "It keeps selling.",
      metadata: { metric: "sales", threshold: sales, actual: video.attributedOrderCount },
    });
    if (!result.skipped) awarded.push(sales === 1 ? "FIRST_SALE" : "SALES_MILESTONE");
  }

  return { awarded: awarded.length, types: awarded };
}

/** The admin's view of the program as a whole. */
/**
 * The programme at a glance.
 *
 * Mixed deliberately. Creator and video counts are chain-wide facts — a video
 * is published to every outlet's product page and a creator belongs to no
 * branch — so they are not cut by scope. The money is: an earning is a cost
 * against one branch's order, and `outstandingCredit` is the company's
 * liability, which a branch-scoped reader has no business being handed. A
 * scoped caller gets their own branches' money and a null where a chain-wide
 * figure would be, rather than a smaller number that reads like the whole.
 *
 * `includeMoney` is separate from scope and answers a different question.
 * This endpoint is reached with `creators.read`, which a content moderator
 * holds and an accountant's `creator_earnings.read` is not implied by. Nulls
 * rather than zeros again: a moderator who may not see the payout should be
 * told there is nothing to show them, not shown a zero.
 */
export async function programOverview({ from, to, branchId = null, scope = null, includeMoney = true } = {}) {
  const branchWhere = earningScopeWhere(scope, branchId);
  const scoped = Object.keys(branchWhere).length > 0;
  const window = from || to
    ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
    : {};

  const [creators, videos, pendingReview, attributions, earnings, wallets] = await Promise.all([
    prisma.creatorProfile.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.creatorVideo.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.creatorVideo.count({ where: { status: "PENDING_REVIEW" } }),
    includeMoney
      ? prisma.creatorOrderAttribution.aggregate({
          where: { ...branchWhere, ...window },
          _count: { _all: true },
          _sum: { lineAmount: true },
        })
      : null,
    includeMoney
      ? prisma.creatorEarning.groupBy({
          by: ["status"],
          where: { ...branchWhere, ...window },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : null,
    // A wallet balance is one creator's spendable credit across the whole
    // chain; there is no honest way to cut it by branch, so a scoped reader
    // is told so rather than shown a figure that means something else.
    includeMoney && !scoped
      ? prisma.creatorWallet.aggregate({ _sum: { balance: true, pendingBalance: true } })
      : null,
  ]);

  return {
    creators: Object.fromEntries(creators.map((row) => [row.status, row._count._all])),
    videos: Object.fromEntries(videos.map((row) => [row.status, row._count._all])),
    pendingReview,
    attributedOrders: attributions ? attributions._count._all : null,
    attributedRevenue: attributions ? money(attributions._sum.lineAmount ?? 0) : null,
    earnings: earnings
      ? Object.fromEntries(
          earnings.map((row) => [row.status, { count: row._count._all, amount: money(row._sum.amount ?? 0) }]),
        )
      : null,
    // The program's outstanding liability: credit issued and not yet spent.
    // Null, not zero, for a scoped reader — zero would be a lie.
    outstandingCredit: wallets ? money(wallets._sum.balance ?? 0) : null,
    heldCredit: wallets ? money(wallets._sum.pendingBalance ?? 0) : null,
    isBranchScoped: scoped,
  };
}
