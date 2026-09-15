import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { logger } from "@/lib/logger";
import { shortCode } from "@/server/utils/crypto";
import { money } from "@/server/accounting/balance";
import { startOfDay } from "@/server/attendance/shift";

/**
 * Views, likes, shares and the public feed.
 *
 * High-volume, low-value writes: nobody is paid because of a view, so nothing
 * here is allowed to fail a request. Every counter is best-effort and the raw
 * event tables are rolled up nightly into `CreatorVideoDailyStat`, which is what
 * the dashboard reads — charting from raw views would scan millions of rows to
 * draw one line.
 *
 * A **view attributes nothing.** That belongs to `creator-attribution.service`
 * and happens only on add-to-cart. Keeping the two apart is what stops a
 * product page with six videos crediting all six for one sale.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const PUBLIC_VIDEO_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  caption: true,
  videoUrl: true,
  thumbnailUrl: true,
  durationSeconds: true,
  widthPx: true,
  heightPx: true,
  viewCount: true,
  likeCount: true,
  shareCount: true,
  publishedAt: true,
  featuredRank: true,
  creator: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
  product: { select: { id: true, name: true, slug: true } },
};

/** Watched at least this long before it counts as a view at all. */
const MIN_VIEW_SECONDS = 2;

/**
 * Records a view.
 *
 * `uniqueViewerCount` is incremented only the first time a given viewer or
 * session is seen, so a video somebody rewatched ten times does not read as ten
 * people. That distinction is the difference between a useful reach number and
 * a vanity one.
 */
export async function recordView({ videoId, viewerId = null, sessionId = null, surface = "PRODUCT_PAGE", shareLinkId = null, watchedSeconds = 0, isComplete = false, ipAddress = null, userAgent = null }) {
  if (Number(watchedSeconds) < MIN_VIEW_SECONDS && !isComplete) {
    return { counted: false, reason: "TOO_SHORT" };
  }

  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, status: true, creatorId: true },
  });
  if (!video || video.status !== "APPROVED") return { counted: false, reason: "NOT_LIVE" };

  try {
    const isFirst = viewerId || sessionId
      ? !(await prisma.creatorVideoView.findFirst({
          where: { videoId, ...(viewerId ? { viewerId } : { sessionId }) },
          select: { id: true },
        }))
      : false;

    await withTransaction(async (tx) => {
      await tx.creatorVideoView.create({
        data: { videoId, viewerId, sessionId, surface, shareLinkId, watchedSeconds, isComplete, ipAddress, userAgent },
      });

      await tx.creatorVideo.update({
        where: { id: videoId },
        data: {
          viewCount: { increment: 1 },
          ...(isFirst ? { uniqueViewerCount: { increment: 1 } } : {}),
          ...(isComplete ? { completedViewCount: { increment: 1 } } : {}),
        },
      });

      await tx.creatorProfile.update({ where: { id: video.creatorId }, data: { totalViews: { increment: 1 } } });
    });

    return { counted: true, unique: isFirst };
  } catch (error) {
    // A lost view is not worth a failed page load.
    logger.warn("recording a view failed", { videoId, error: error.message });
    return { counted: false, reason: "ERROR" };
  }
}

/** Likes toggle. The unique key per viewer is what makes it idempotent. */
export async function toggleLike({ videoId, userId = null, sessionId = null }) {
  if (!userId && !sessionId) {
    throw ApiError.validation("Who is liking this?", { sessionId: ["A session or a signed-in user is required"] });
  }

  const video = await prisma.creatorVideo.findUnique({ where: { id: videoId }, select: { id: true, status: true } });
  if (!video || video.status !== "APPROVED") throw ApiError.notFound("Video not found");

  const where = userId ? { videoId_userId: { videoId, userId } } : { videoId_sessionId: { videoId, sessionId } };

  const existing = await prisma.creatorVideoLike.findUnique({ where, select: { id: true } });

  if (existing) {
    await withTransaction(async (tx) => {
      await tx.creatorVideoLike.delete({ where: { id: existing.id } });
      await tx.creatorVideo.update({ where: { id: videoId }, data: { likeCount: { decrement: 1 } } });
    });

    return { liked: false };
  }

  await withTransaction(async (tx) => {
    await tx.creatorVideoLike.create({ data: { videoId, userId, sessionId } });
    await tx.creatorVideo.update({ where: { id: videoId }, data: { likeCount: { increment: 1 } } });
  });

  return { liked: true };
}

/**
 * A trackable share link.
 *
 * One per (video, creator, channel) rather than a new code each time — a
 * creator who taps "share to WhatsApp" twice should get the same link, or their
 * click counts fragment across a dozen codes and none of them mean anything.
 */
export async function createShareLink({ videoId, creatorId = null, channel = null, campaign = null, createdById = null }) {
  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, status: true, creatorId: true },
  });
  if (!video || video.status !== "APPROVED") throw ApiError.notFound("Video not found");

  const owner = creatorId ?? video.creatorId;

  const existing = await prisma.creatorShareLink.findFirst({
    where: { videoId, creatorId: owner, channel: channel ?? null, campaign: campaign ?? null, isActive: true },
    select: { id: true, code: true, clickCount: true, channel: true, campaign: true },
  });
  if (existing) return existing;

  return prisma.creatorShareLink.create({
    data: { code: shortCode(10), videoId, creatorId: owner, channel, campaign, createdById },
    select: { id: true, code: true, clickCount: true, channel: true, campaign: true },
  });
}

/** Records the intent to share. The click that comes back is tracked separately. */
export async function recordShare({ videoId, channel = "COPY_LINK", shareLinkId = null, sharedById = null, sessionId = null }) {
  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, status: true, creatorId: true },
  });
  if (!video || video.status !== "APPROVED") throw ApiError.notFound("Video not found");

  const link = shareLinkId
    ? { id: shareLinkId }
    : await createShareLink({ videoId, creatorId: video.creatorId, channel, createdById: sharedById });

  await withTransaction(async (tx) => {
    await tx.creatorVideoShare.create({
      data: { videoId, shareLinkId: link.id, channel, sharedById, sessionId },
    });
    await tx.creatorVideo.update({ where: { id: videoId }, data: { shareCount: { increment: 1 } } });
    await tx.creatorProfile.update({ where: { id: video.creatorId }, data: { totalShares: { increment: 1 } } });
  });

  return { shared: true, shareLink: link };
}

/**
 * Follows a share link.
 *
 * Returns the video so the storefront can render it, and records the click. The
 * click is what makes off-platform sharing measurable at all — a creator posting
 * to Instagram otherwise has no idea whether it worked.
 */
export async function followShareLink({ code, sessionId = null, userId = null, referrer = null, ipAddress = null, userAgent = null }) {
  const link = await prisma.creatorShareLink.findUnique({
    where: { code },
    select: { id: true, videoId: true, isActive: true, channel: true, campaign: true },
  });
  if (!link || !link.isActive) throw ApiError.notFound("That link is no longer active");

  const video = await prisma.creatorVideo.findUnique({ where: { id: link.videoId }, select: PUBLIC_VIDEO_SELECT });
  if (!video) throw ApiError.notFound("Video not found");

  await withTransaction(async (tx) => {
    await tx.creatorShareLinkClick.create({
      data: { shareLinkId: link.id, sessionId, userId, referrer, ipAddress, userAgent },
    });
    await tx.creatorShareLink.update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 }, lastClickedAt: new Date() },
    });
  });

  return { video, shareLinkId: link.id, channel: link.channel, campaign: link.campaign };
}

// --- the public feed --------------------------------------------------------

/**
 * Videos on a product page.
 *
 * Featured first, then most recently published. Not ordered by views: a feed
 * ordered by popularity is one where the video that happened to go up first
 * stays on top for ever, and no new creator can ever get seen.
 */
export async function videosForProduct({ productId, limit = 10 }) {
  return prisma.creatorVideo.findMany({
    where: { productId, status: "APPROVED", creator: { status: "ACTIVE" } },
    select: PUBLIC_VIDEO_SELECT,
    orderBy: [{ featuredRank: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }],
    take: limit,
  });
}

/** The browse feed. */
export async function videoFeed({ categoryId, creatorHandle, limit = 20, cursor } = {}) {
  const rows = await prisma.creatorVideo.findMany({
    where: {
      status: "APPROVED",
      creator: { status: "ACTIVE", ...(creatorHandle ? { handle: creatorHandle } : {}) },
      ...(categoryId ? { product: { categoryId } } : {}),
    },
    select: PUBLIC_VIDEO_SELECT,
    orderBy: [{ featuredRank: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function publicVideo(id) {
  const video = await prisma.creatorVideo.findUnique({ where: { id }, select: PUBLIC_VIDEO_SELECT });
  if (!video) throw ApiError.notFound("Video not found");

  const status = await prisma.creatorVideo.findUnique({
    where: { id },
    select: { status: true, creator: { select: { status: true } } },
  });
  if (status.status !== "APPROVED" || status.creator.status !== "ACTIVE") throw ApiError.notFound("Video not found");

  return video;
}

/** Admin curation: pinning a video to the top of a product's feed. */
export async function setFeaturedRank(videoId, { rank, actor }) {
  const video = await prisma.creatorVideo.findUnique({ where: { id: videoId }, select: { id: true, status: true } });
  if (!video) throw ApiError.notFound("Video not found");

  return prisma.creatorVideo.update({
    where: { id: videoId },
    data: { featuredRank: rank },
    select: { id: true, featuredRank: true },
  });
}

// --- rollups ----------------------------------------------------------------

/**
 * Folds a day's raw events into one row per video.
 *
 * What the dashboard charts read. Idempotent per (video, date) so a re-run
 * after a partial failure corrects rather than duplicates.
 */
export async function rollUpDay({ date = new Date(), videoId = null } = {}) {
  const day = startOfDay(date);
  const next = new Date(day.getTime() + 86_400_000);
  const window = { gte: day, lt: next };

  const active = await prisma.creatorVideo.findMany({
    where: {
      ...(videoId ? { id: videoId } : {}),
      OR: [
        { views: { some: { createdAt: window } } },
        { likes: { some: { createdAt: window } } },
        { shares: { some: { createdAt: window } } },
        { orderAttributions: { some: { createdAt: window } } },
      ],
    },
    select: { id: true },
  });

  let written = 0;

  for (const video of active) {
    const [views, uniqueViewers, completed, likes, shares, clicks, attributions, earnings] = await Promise.all([
      prisma.creatorVideoView.count({ where: { videoId: video.id, createdAt: window } }),
      prisma.creatorVideoView
        .findMany({ where: { videoId: video.id, createdAt: window }, select: { viewerId: true, sessionId: true } })
        .then((rows) => new Set(rows.map((row) => row.viewerId ?? row.sessionId ?? Math.random())).size),
      prisma.creatorVideoView.count({ where: { videoId: video.id, createdAt: window, isComplete: true } }),
      prisma.creatorVideoLike.count({ where: { videoId: video.id, createdAt: window } }),
      prisma.creatorVideoShare.count({ where: { videoId: video.id, createdAt: window } }),
      prisma.creatorShareLinkClick.count({ where: { shareLink: { videoId: video.id }, createdAt: window } }),
      prisma.creatorOrderAttribution.aggregate({
        where: { videoId: video.id, createdAt: window },
        _count: { _all: true },
        _sum: { lineAmount: true },
      }),
      prisma.creatorEarning.aggregate({
        where: { videoId: video.id, createdAt: window, status: { notIn: ["REVERSED", "REJECTED"] } },
        _sum: { amount: true },
      }),
    ]);

    const addToCarts = await prisma.creatorAttributionTouch.count({
      where: { videoId: video.id, occurredAt: window },
    });

    await prisma.creatorVideoDailyStat.upsert({
      where: { videoId_statDate: { videoId: video.id, statDate: day } },
      create: {
        videoId: video.id,
        statDate: day,
        views,
        uniqueViewers,
        completedViews: completed,
        likes,
        shares,
        linkClicks: clicks,
        addToCarts,
        attributedOrders: attributions._count._all,
        attributedRevenue: money(attributions._sum.lineAmount ?? 0),
        earnings: money(earnings._sum.amount ?? 0),
      },
      update: {
        views,
        uniqueViewers,
        completedViews: completed,
        likes,
        shares,
        linkClicks: clicks,
        addToCarts,
        attributedOrders: attributions._count._all,
        attributedRevenue: money(attributions._sum.lineAmount ?? 0),
        earnings: money(earnings._sum.amount ?? 0),
      },
    });

    written += 1;
  }

  return { date: day, videos: written };
}

/**
 * Prunes raw view rows past their retention window.
 *
 * The rollups keep the history; the raw events are only needed long enough to
 * build them and to investigate something. Keeping them for ever makes the
 * biggest table in the system one nobody reads.
 */
export async function pruneViewEvents({ retentionDays = 90, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

  const [views, clicks] = await Promise.all([
    prisma.creatorVideoView.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.creatorShareLinkClick.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return { views: views.count, clicks: clicks.count, cutoff };
}

/** A video's own chart data. */
export async function videoStats({ videoId, from, to }) {
  return prisma.creatorVideoDailyStat.findMany({
    where: {
      videoId,
      ...(from || to
        ? { statDate: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: startOfDay(to) } : {}) } }
        : {}),
    },
    select: {
      statDate: true,
      views: true,
      uniqueViewers: true,
      completedViews: true,
      likes: true,
      shares: true,
      linkClicks: true,
      addToCarts: true,
      attributedOrders: true,
      attributedRevenue: true,
      earnings: true,
    },
    orderBy: { statDate: "asc" },
  });
}
