import { prisma } from "@/lib/prisma";
import { ApiError, assertPermission } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { enqueue } from "@/server/jobs/outbox";
import { attemptsRemaining, canReupload } from "@/server/creator/strikes";
import { programConfig, requireActiveCreator } from "@/server/services/creator.service";

/**
 * Creator videos and the moderation queue.
 *
 * The rules here exist because this is user-generated content attached to a
 * commercial product page:
 *
 *   * **Proof of purchase is structural.** A video is bound to one `OrderItem`
 *     the creator actually bought, and the product it goes live against is the
 *     product on that line. Somebody cannot film a competitor's burger and
 *     attach it to ours, because the line they are uploading against says what
 *     they bought.
 *   * **One video per purchased line, re-uploaded in place.** A rejection is
 *     not a dead end — the creator replaces the asset and resubmits, and every
 *     attempt is kept so a moderator can see what was rejected and why.
 *   * **The attempt limit counts rejections.** Five bad clips against the same
 *     line locks it for ever; moderators are not a free retry loop.
 *   * **Approval is a publish.** A video going live changes what shoppers see,
 *     so it is its own permission, separate from reviewing.
 */

const VIDEO_SELECT = {
  id: true,
  creatorId: true,
  orderId: true,
  orderItemId: true,
  productId: true,
  variantId: true,
  status: true,
  caption: true,
  videoUrl: true,
  thumbnailUrl: true,
  durationSeconds: true,
  widthPx: true,
  heightPx: true,
  sizeBytes: true,
  mimeType: true,
  attemptCount: true,
  rejectionCount: true,
  isLocked: true,
  lastRejectionReason: true,
  lastRejectionNote: true,
  submittedAt: true,
  reviewedAt: true,
  publishedAt: true,
  takenDownAt: true,
  takedownReason: true,
  viewCount: true,
  uniqueViewerCount: true,
  completedViewCount: true,
  likeCount: true,
  shareCount: true,
  addToCartCount: true,
  attributedOrderCount: true,
  earnedTotal: true,
  featuredRank: true,
  createdAt: true,
  creator: { select: { id: true, handle: true, displayName: true, avatarUrl: true, status: true } },
  product: { select: { id: true, name: true, slug: true, categoryId: true } },
};

const REVIEW_SELECT = {
  id: true,
  attemptNumber: true,
  decision: true,
  reason: true,
  note: true,
  orderVerified: true,
  productMatched: true,
  qualityApproved: true,
  reviewedById: true,
  reviewedAt: true,
};

/** Statuses from which a creator may submit for review. */
const SUBMITTABLE = ["DRAFT", "REJECTED"];

/**
 * Starts a video against a purchased line.
 *
 * The order line is the whole authorisation: it proves the creator bought the
 * product, and it decides which product the video can be shown against. Neither
 * is taken from the request.
 */
export async function createVideo({ userId, orderItemId, caption = null }) {
  const config = await programConfig();
  const creator = await requireActiveCreator(userId);

  const orderItem = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      productId: true,
      variantId: true,
      nameSnapshot: true,
      status: true,
      order: { select: { id: true, userId: true, status: true, completedAt: true, placedAt: true, orderNumber: true } },
    },
  });
  if (!orderItem) throw ApiError.validation("Order line not found", { orderItemId: ["No such line"] });

  // Somebody else's order is not proof that *you* bought anything.
  if (orderItem.order.userId !== userId) {
    throw ApiError.forbidden("That order line is not yours");
  }
  if (orderItem.order.status !== "COMPLETED") {
    throw ApiError.conflict("You can film an order once it is complete", { status: orderItem.order.status });
  }
  if (orderItem.status === "CANCELLED") {
    throw ApiError.conflict("That line was cancelled");
  }
  if (!orderItem.productId) {
    throw ApiError.conflict("That line is not a product a video can be attached to");
  }

  // The window keeps the feed current: a video of a dish somebody ate three
  // months ago is not what the product looks like today.
  const completedAt = orderItem.order.completedAt ?? orderItem.order.placedAt;
  const deadline = new Date(new Date(completedAt).getTime() + config.submissionWindowDays * 86_400_000);
  if (new Date() > deadline) {
    throw ApiError.conflict(`Videos can be submitted within ${config.submissionWindowDays} days of the order`, {
      deadline,
    });
  }

  const existing = await prisma.creatorVideo.findUnique({
    where: { orderItemId },
    select: { id: true, status: true, isLocked: true },
  });
  if (existing) {
    throw ApiError.conflict("You already have a video for this item", {
      videoId: existing.id,
      status: existing.status,
      hint: "Replace its asset instead of starting again",
    });
  }

  const video = await prisma.creatorVideo.create({
    data: {
      creatorId: creator.id,
      orderId: orderItem.order.id,
      orderItemId,
      productId: orderItem.productId,
      variantId: orderItem.variantId,
      caption,
      status: "DRAFT",
    },
    select: VIDEO_SELECT,
  });

  await prisma.creatorProfile.update({ where: { id: creator.id }, data: { videoCount: { increment: 1 } } });

  return { ...video, attemptsRemaining: attemptsRemaining({ rejectionCount: 0, maxUploadAttempts: config.maxUploadAttempts }) };
}

async function loadVideo(id, { userId = null } = {}) {
  const video = await prisma.creatorVideo.findUnique({ where: { id }, select: VIDEO_SELECT });
  if (!video) throw ApiError.notFound("Video not found");

  if (userId) {
    const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!creator || creator.id !== video.creatorId) throw ApiError.notFound("Video not found");
  }

  return video;
}

/**
 * Attaches an uploaded asset, as a new attempt.
 *
 * Duration is validated here against the program config rather than trusted
 * from the client: the whole format depends on videos being short, and a client
 * that reports 20 seconds for a 4-minute file would otherwise put it on the
 * product page.
 */
export async function attachAsset({ userId, videoId, asset }) {
  const config = await programConfig();
  await requireActiveCreator(userId);
  const video = await loadVideo(videoId, { userId });

  if (video.isLocked) {
    throw ApiError.conflict("This item has used all its attempts and is locked");
  }
  if (["APPROVED", "PENDING_REVIEW"].includes(video.status)) {
    throw ApiError.conflict(
      video.status === "APPROVED"
        ? "This video is live. Withdraw it before replacing the file."
        : "This video is already waiting for review",
      { status: video.status },
    );
  }
  if (!canReupload({ rejectionCount: video.rejectionCount, maxUploadAttempts: config.maxUploadAttempts, isLocked: video.isLocked })) {
    throw ApiError.conflict("No attempts left for this item");
  }

  const duration = Number(asset.durationSeconds ?? 0);
  if (duration < config.minVideoSeconds || duration > config.maxVideoSeconds) {
    throw ApiError.validation(
      `Videos must be between ${config.minVideoSeconds} and ${config.maxVideoSeconds} seconds`,
      { durationSeconds: [`That one is ${duration || "an unknown number of"} seconds`] },
    );
  }
  if (asset.sizeBytes != null && Number(asset.sizeBytes) > config.maxVideoSizeBytes) {
    throw ApiError.validation("That file is too large", {
      sizeBytes: [`The limit is ${Math.round(config.maxVideoSizeBytes / 1_048_576)} MB`],
    });
  }
  if (asset.mimeType && config.allowedMimeTypes.length && !config.allowedMimeTypes.includes(asset.mimeType)) {
    throw ApiError.validation("That file type is not accepted", {
      mimeType: [`Accepted: ${config.allowedMimeTypes.join(", ")}`],
    });
  }

  const attemptNumber = video.attemptCount + 1;

  return withTransaction(async (tx) => {
    // Older attempts stay, marked superseded — a moderator needs to see what
    // was rejected, not just the latest file.
    await tx.creatorVideoAsset.updateMany({ where: { videoId, isCurrent: true }, data: { isCurrent: false } });

    await tx.creatorVideoAsset.create({
      data: {
        videoId,
        attemptNumber,
        videoUrl: asset.videoUrl,
        storageKey: asset.storageKey,
        thumbnailUrl: asset.thumbnailUrl ?? null,
        durationSeconds: duration,
        sizeBytes: asset.sizeBytes ?? null,
        mimeType: asset.mimeType ?? null,
        isCurrent: true,
      },
    });

    return tx.creatorVideo.update({
      where: { id: videoId },
      data: {
        status: "DRAFT",
        videoUrl: asset.videoUrl,
        storageKey: asset.storageKey,
        thumbnailUrl: asset.thumbnailUrl ?? null,
        durationSeconds: duration,
        widthPx: asset.widthPx ?? null,
        heightPx: asset.heightPx ?? null,
        sizeBytes: asset.sizeBytes ?? null,
        mimeType: asset.mimeType ?? null,
        attemptCount: attemptNumber,
      },
      select: VIDEO_SELECT,
    });
  });
}

/** Sends it to the queue. Auto-approval is a config switch, off by default. */
export async function submitVideo({ userId, videoId }) {
  const config = await programConfig();
  await requireActiveCreator(userId);
  const video = await loadVideo(videoId, { userId });

  if (!SUBMITTABLE.includes(video.status)) {
    throw ApiError.conflict(`A ${video.status.toLowerCase().replace(/_/g, " ")} video cannot be submitted`, {
      status: video.status,
    });
  }
  if (!video.videoUrl) {
    throw ApiError.conflict("Upload a video first");
  }
  if (video.isLocked) throw ApiError.conflict("This item is locked");

  const submitted = await prisma.creatorVideo.update({
    where: { id: videoId },
    data: {
      status: config.autoApproveVideos ? "APPROVED" : "PENDING_REVIEW",
      submittedAt: new Date(),
      ...(config.autoApproveVideos ? { publishedAt: new Date() } : {}),
    },
    select: VIDEO_SELECT,
  });

  if (config.autoApproveVideos) {
    await afterPublish(submitted);
  }

  return submitted;
}

/** Bookkeeping shared by manual approval and auto-approval. */
async function afterPublish(video) {
  await prisma.creatorProfile.update({
    where: { id: video.creatorId },
    data: { approvedVideoCount: { increment: 1 } },
  });

  const approved = await prisma.creatorVideo.count({
    where: { creatorId: video.creatorId, status: "APPROVED" },
  });

  // The first approval is the moment somebody becomes a creator in their own
  // eyes, and it is worth saying so.
  if (approved === 1) {
    await enqueue({
      eventType: "creator.appreciation",
      payload: {
        creatorId: video.creatorId,
        videoId: video.id,
        type: "FIRST_VIDEO_APPROVED",
        title: "Your first video is live",
        message: "It is now on the product page. Share it and start earning.",
      },
    });
  }

  await enqueue({ eventType: "creator.video_published", payload: { videoId: video.id } });
}

/**
 * A moderator's decision.
 *
 * Every decision is written to the immutable review log, including the three
 * checks the reviewer confirmed. "Rejected" with no record of what was checked
 * is not reviewable by anybody afterwards.
 */
export async function reviewVideo(videoId, { decision, reason = null, note = null, checks = {}, actor }) {
  // Publishing is a different authority from rejecting: approving puts
  // user-generated video on a commercial product page, sending it back does
  // not. Checked here rather than at the route, which only gates the queue.
  assertPermission(actor, decision === "APPROVED" ? "creator_videos.publish" : "creator_videos.reject");

  const config = await programConfig();
  const video = await loadVideo(videoId);

  if (decision === "APPROVED" && video.status !== "PENDING_REVIEW") {
    throw ApiError.conflict("Only a video waiting for review can be approved", { status: video.status });
  }
  if (decision === "REJECTED" && !["PENDING_REVIEW", "APPROVED"].includes(video.status)) {
    throw ApiError.conflict("There is nothing to reject", { status: video.status });
  }
  if (decision === "REJECTED" && !reason) {
    throw ApiError.validation("Say why it was rejected", { reason: ["A rejection needs a reason"] });
  }

  const result = await withTransaction(async (tx) => {
    await tx.creatorVideoReview.create({
      data: {
        videoId,
        attemptNumber: video.attemptCount,
        decision,
        reason,
        note,
        orderVerified: checks.orderVerified ?? false,
        productMatched: checks.productMatched ?? false,
        qualityApproved: checks.qualityApproved ?? false,
        reviewedById: actor?.userId ?? null,
      },
    });

    if (decision === "APPROVED") {
      return tx.creatorVideo.update({
        where: { id: videoId },
        data: {
          status: "APPROVED",
          publishedAt: new Date(),
          reviewedById: actor?.userId ?? null,
          reviewedAt: new Date(),
          lastRejectionReason: null,
          lastRejectionNote: null,
        },
        select: VIDEO_SELECT,
      });
    }

    const rejectionCount = video.rejectionCount + 1;
    // The limit is what stops moderators reviewing the same unusable clip for
    // ever. Hit it and the line is closed permanently.
    const isLocked = rejectionCount >= config.maxUploadAttempts;

    return tx.creatorVideo.update({
      where: { id: videoId },
      data: {
        status: isLocked ? "LOCKED" : "REJECTED",
        rejectionCount,
        isLocked,
        lastRejectionReason: reason,
        lastRejectionNote: note,
        reviewedById: actor?.userId ?? null,
        reviewedAt: new Date(),
      },
      select: VIDEO_SELECT,
    });
  });

  if (decision === "APPROVED") await afterPublish(result);

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: `creator_video.${decision.toLowerCase()}`,
    entityType: "CreatorVideo",
    entityId: videoId,
    changes: { decision, reason, attempt: video.attemptCount, locked: result.isLocked },
  });

  await enqueue({
    eventType: "creator.video_reviewed",
    payload: { videoId, decision, reason, creatorId: video.creatorId },
  });

  return {
    ...result,
    attemptsRemaining: attemptsRemaining({
      rejectionCount: result.rejectionCount,
      maxUploadAttempts: config.maxUploadAttempts,
    }),
  };
}

/**
 * Pulls a live video.
 *
 * Existing attributions are left alone by default: a video taken down for poor
 * quality did not un-sell the food somebody already bought. `revokeAttributions`
 * is the explicit choice for fraud, where the sale itself is in question.
 */
export async function takeDownVideo(videoId, { reason, revokeAttributions = false, actor }) {
  const video = await loadVideo(videoId);

  if (!["APPROVED", "PENDING_REVIEW"].includes(video.status)) {
    throw ApiError.conflict("That video is not live", { status: video.status });
  }

  const result = await withTransaction(async (tx) => {
    await tx.creatorVideoReview.create({
      data: {
        videoId,
        attemptNumber: video.attemptCount,
        decision: "TAKEN_DOWN",
        note: reason,
        reviewedById: actor?.userId ?? null,
      },
    });

    if (revokeAttributions) {
      await tx.creatorAttribution.updateMany({
        where: { videoId, status: "ACTIVE" },
        data: { status: "REVOKED" },
      });
    }

    const updated = await tx.creatorVideo.update({
      where: { id: videoId },
      data: {
        status: "TAKEN_DOWN",
        takenDownAt: new Date(),
        takedownReason: reason,
        reviewedById: actor?.userId ?? null,
        reviewedAt: new Date(),
      },
      select: VIDEO_SELECT,
    });

    if (video.status === "APPROVED") {
      await tx.creatorProfile.update({
        where: { id: video.creatorId },
        data: { approvedVideoCount: { decrement: 1 } },
      });
    }

    return updated;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_video.takedown",
    entityType: "CreatorVideo",
    entityId: videoId,
    changes: { reason, revokeAttributions, creatorId: video.creatorId },
  });

  return result;
}

/** Puts a taken-down video back. */
export async function reinstateVideo(videoId, { note = null, actor }) {
  const video = await loadVideo(videoId);
  if (video.status !== "TAKEN_DOWN") {
    throw ApiError.conflict("That video has not been taken down", { status: video.status });
  }

  const result = await withTransaction(async (tx) => {
    await tx.creatorVideoReview.create({
      data: {
        videoId,
        attemptNumber: video.attemptCount,
        decision: "REINSTATED",
        note,
        reviewedById: actor?.userId ?? null,
      },
    });

    await tx.creatorProfile.update({
      where: { id: video.creatorId },
      data: { approvedVideoCount: { increment: 1 } },
    });

    return tx.creatorVideo.update({
      where: { id: videoId },
      data: { status: "APPROVED", takenDownAt: null, takedownReason: null, reviewedAt: new Date() },
      select: VIDEO_SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_video.reinstate",
    entityType: "CreatorVideo",
    entityId: videoId,
    changes: { note },
  });

  return result;
}

/** A creator withdrawing their own video. */
export async function archiveVideo({ userId, videoId }) {
  const video = await loadVideo(videoId, { userId });

  if (["LOCKED", "ARCHIVED"].includes(video.status)) {
    throw ApiError.conflict(`That video is already ${video.status.toLowerCase()}`);
  }

  return withTransaction(async (tx) => {
    if (video.status === "APPROVED") {
      await tx.creatorProfile.update({
        where: { id: video.creatorId },
        data: { approvedVideoCount: { decrement: 1 } },
      });
    }

    return tx.creatorVideo.update({ where: { id: videoId }, data: { status: "ARCHIVED" }, select: VIDEO_SELECT });
  });
}

export async function getVideo(id, { userId = null } = {}) {
  const video = await loadVideo(id, { userId });
  const config = await programConfig();

  const [assets, reviews] = await Promise.all([
    prisma.creatorVideoAsset.findMany({
      where: { videoId: id },
      select: { id: true, attemptNumber: true, videoUrl: true, thumbnailUrl: true, durationSeconds: true, isCurrent: true, uploadedAt: true },
      orderBy: { attemptNumber: "desc" },
    }),
    prisma.creatorVideoReview.findMany({ where: { videoId: id }, select: REVIEW_SELECT, orderBy: { reviewedAt: "desc" } }),
  ]);

  return {
    ...video,
    assets,
    reviews,
    attemptsRemaining: attemptsRemaining({
      rejectionCount: video.rejectionCount,
      maxUploadAttempts: config.maxUploadAttempts,
    }),
  };
}

export async function listVideos({ creatorId, productId, status, isLocked, limit = 20, cursor } = {}) {
  const rows = await prisma.creatorVideo.findMany({
    where: {
      ...(creatorId ? { creatorId } : {}),
      ...(productId ? { productId } : {}),
      ...(status ? { status } : {}),
      ...(isLocked != null ? { isLocked } : {}),
    },
    select: VIDEO_SELECT,
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/** The moderation queue: oldest submission first, so nobody waits for ever. */
export async function reviewQueue({ limit = 20, cursor } = {}) {
  const rows = await prisma.creatorVideo.findMany({
    where: { status: "PENDING_REVIEW" },
    select: {
      ...VIDEO_SELECT,
      order: { select: { id: true, orderNumber: true, completedAt: true } },
    },
    orderBy: { submittedAt: "asc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/** A creator's own videos, with what they can still do to each. */
export async function myVideos({ userId, status, limit = 20, cursor }) {
  const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!creator) throw ApiError.notFound("You are not part of the creator program");

  const config = await programConfig();
  const page = await listVideos({ creatorId: creator.id, status, limit, cursor });

  return {
    ...page,
    items: page.items.map((video) => ({
      ...video,
      attemptsRemaining: attemptsRemaining({
        rejectionCount: video.rejectionCount,
        maxUploadAttempts: config.maxUploadAttempts,
      }),
      canReupload: canReupload({
        rejectionCount: video.rejectionCount,
        maxUploadAttempts: config.maxUploadAttempts,
        isLocked: video.isLocked,
      }),
    })),
  };
}

/** Order lines this creator could still film. */
export async function filmableOrderItems({ userId }) {
  const config = await programConfig();
  const cutoff = new Date(Date.now() - config.submissionWindowDays * 86_400_000);

  const items = await prisma.orderItem.findMany({
    where: {
      order: { userId, status: "COMPLETED", placedAt: { gte: cutoff } },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      productId: true,
      variantId: true,
      nameSnapshot: true,
      quantity: true,
      order: { select: { id: true, orderNumber: true, completedAt: true, placedAt: true } },
    },
    orderBy: { id: "desc" },
    take: 100,
  });

  // `CreatorVideo.orderItemId` is a unique column rather than a relation, so
  // "lines with no video yet" is a second lookup rather than a nested filter.
  const taken = await prisma.creatorVideo.findMany({
    where: { orderItemId: { in: items.map((item) => item.id) } },
    select: { orderItemId: true },
  });
  const used = new Set(taken.map((row) => row.orderItemId));

  return items.filter((item) => !used.has(item.id)).slice(0, 50);
}

// --- viewer reports ---------------------------------------------------------

export async function reportVideo({ videoId, reason, note = null, userId = null, sessionId = null }) {
  const video = await prisma.creatorVideo.findUnique({ where: { id: videoId }, select: { id: true, status: true } });
  if (!video || video.status !== "APPROVED") throw ApiError.notFound("Video not found");

  const report = await prisma.creatorVideoReport.create({
    data: { videoId, reason, note, reportedById: userId, sessionId },
    select: { id: true, videoId: true, reason: true, status: true, createdAt: true },
  });

  return report;
}

export async function listReports({ status = "OPEN", videoId, limit = 20, cursor } = {}) {
  const rows = await prisma.creatorVideoReport.findMany({
    where: { ...(status ? { status } : {}), ...(videoId ? { videoId } : {}) },
    select: {
      id: true,
      videoId: true,
      reason: true,
      note: true,
      status: true,
      reportedById: true,
      reviewedById: true,
      reviewedAt: true,
      createdAt: true,
      video: { select: { id: true, status: true, creator: { select: { id: true, handle: true } } } },
    },
    orderBy: { createdAt: "asc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function resolveReport(id, { status, actor }) {
  const report = await prisma.creatorVideoReport.findUnique({ where: { id }, select: { id: true, videoId: true } });
  if (!report) throw ApiError.notFound("Report not found");

  return prisma.creatorVideoReport.update({
    where: { id },
    data: { status, reviewedById: actor?.userId ?? null, reviewedAt: new Date() },
    select: { id: true, status: true, reviewedAt: true },
  });
}
