import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";

/**
 * Reviews.
 *
 * The rule that makes them worth anything: **you may only review what you
 * bought**. A review must name a completed order of the caller's that actually
 * contained the product. Without that, the ratings are just an open comment box
 * and the first competitor or bot to find it decides what the food is worth.
 *
 * New reviews land as `PENDING` and are invisible until moderated. That is the
 * conservative default — publishing first and removing later means the abuse
 * has already been seen.
 */

const SELECT = {
  id: true,
  userId: true,
  orderId: true,
  productId: true,
  driverId: true,
  rating: true,
  comment: true,
  status: true,
  moderatedById: true,
  moderatedAt: true,
  createdAt: true,
};

const WITH_CONTEXT = {
  ...SELECT,
  user: { select: { id: true, name: true } },
  product: { select: { id: true, name: true, slug: true, imageUrl: true } },
};

/** Orders whose food has actually been received. */
const REVIEWABLE_STATUSES = ["DELIVERED", "COMPLETED"];

/**
 * Checks the caller bought this, then records the review.
 *
 * The `@@unique([userId, orderId, productId])` index cannot enforce
 * one-review-per-thing on its own, because Postgres treats NULLs in a unique
 * index as distinct and `productId` is nullable — an order-level review would
 * be insertable any number of times. The explicit check below is the real
 * guard; the index is the backstop.
 */
export async function submitReview({ userId, orderId, productId = null, rating, comment = null }) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      items: { select: { productId: true } },
      delivery: { select: { driverId: true } },
    },
  });
  // NOT_FOUND rather than FORBIDDEN: confirming someone else's order id exists
  // would let a caller enumerate orders.
  if (!order) throw ApiError.notFound("Order not found");

  if (!REVIEWABLE_STATUSES.includes(order.status)) {
    throw ApiError.conflict("You can review an order once it has been delivered", { status: order.status });
  }

  if (productId && !order.items.some((item) => item.productId === productId)) {
    throw ApiError.validation("That item was not part of this order", {
      productId: ["Review something you ordered"],
    });
  }

  const existing = await prisma.review.findFirst({
    where: { userId, orderId, productId },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict(productId ? "You have already reviewed this item" : "You have already reviewed this order");
  }

  return prisma.review.create({
    data: {
      userId,
      orderId,
      productId,
      driverId: order.delivery?.driverId ?? null,
      rating,
      comment,
      status: "PENDING",
    },
    select: SELECT,
  });
}

/** A customer editing their own review sends it back for moderation. */
export async function updateOwnReview({ id, userId, rating, comment }) {
  const review = await prisma.review.findFirst({ where: { id, userId }, select: { id: true, status: true } });
  if (!review) throw ApiError.notFound("Review not found");

  return prisma.review.update({
    where: { id },
    data: {
      ...(rating !== undefined ? { rating } : {}),
      ...(comment !== undefined ? { comment } : {}),
      // Edited content has not been seen by a moderator, so it goes back in
      // the queue rather than staying published.
      status: "PENDING",
      moderatedById: null,
      moderatedAt: null,
    },
    select: SELECT,
  });
}

export async function deleteOwnReview({ id, userId }) {
  const review = await prisma.review.findFirst({ where: { id, userId }, select: { id: true } });
  if (!review) throw ApiError.notFound("Review not found");

  await prisma.review.delete({ where: { id } });
  return { deleted: true, id };
}

export async function listOwnReviews({ userId, limit = 20, cursor }) {
  const rows = await prisma.review.findMany({
    where: { userId },
    select: WITH_CONTEXT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/** The moderation queue. */
export async function listReviews({ status, productId, rating, limit = 20, cursor } = {}) {
  const rows = await prisma.review.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(productId ? { productId } : {}),
      ...(rating ? { rating } : {}),
    },
    select: WITH_CONTEXT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function moderateReview({ id, status, actorId }) {
  const review = await prisma.review.findUnique({ where: { id }, select: { id: true } });
  if (!review) throw ApiError.notFound("Review not found");

  return prisma.review.update({
    where: { id },
    data: { status, moderatedById: actorId, moderatedAt: new Date() },
    select: SELECT,
  });
}

/**
 * Published reviews for a product, with its rating summary.
 *
 * The distribution comes back alongside the average because "4.2 from 500
 * reviews" and "4.2 from 5" are very different claims, and a bare average hides
 * which one this is.
 */
export async function productReviews({ productId, limit = 20, cursor }) {
  const [rows, grouped] = await Promise.all([
    prisma.review.findMany({
      where: { productId, status: "PUBLISHED" },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorArgs(cursor, limit),
    }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { productId, status: "PUBLISHED" },
      _count: { _all: true },
    }),
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const row of grouped) {
    distribution[row.rating] = row._count._all;
    total += row._count._all;
    sum += row.rating * row._count._all;
  }

  const page = toPage(rows, limit);

  return {
    ...page,
    summary: {
      average: total ? Number((sum / total).toFixed(2)) : null,
      count: total,
      distribution,
    },
  };
}
