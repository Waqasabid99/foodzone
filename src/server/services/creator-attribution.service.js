import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import { money } from "@/server/accounting/balance";
import { expiryFrom, isSelfPurchase, matchLines, shouldSupersede, videoCanAttribute } from "@/server/creator/attribution";
import { programConfig } from "@/server/services/creator.service";

/**
 * Who gets credit for a sale.
 *
 * Attribution is created **only on add-to-cart from a video** — never on a
 * view. A product page with six videos would otherwise credit all six for a
 * sale any of them, or none of them, caused.
 *
 * It lives on the cart, one row per product, and the last video to put that
 * product in the basket wins. Every touch is kept, so "why did this creator get
 * paid" has an answer.
 *
 * At checkout the live rows are **copied onto the order**, because the cart is
 * emptied straight afterwards. The order copy — not the cart row — is what the
 * commission engine reads when the order completes.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  cartId: true,
  videoId: true,
  creatorId: true,
  productId: true,
  variantId: true,
  viewerId: true,
  sessionId: true,
  surface: true,
  shareLinkId: true,
  status: true,
  attributedAt: true,
  expiresAt: true,
  touchCount: true,
  video: { select: { id: true, status: true, creator: { select: { id: true, handle: true, displayName: true } } } },
};

/**
 * Records that somebody added a product to their cart from a video.
 *
 * Deliberately forgiving: a failure here must never stop the item reaching the
 * basket. Attribution is a marketing attribution, and losing one is a much
 * smaller problem than a shopper who cannot buy.
 */
export async function recordAddToCart({ cart, videoId, surface = "PRODUCT_PAGE", shareLinkId = null, sessionId = null }) {
  const config = await programConfig();
  if (!config.isEnabled) return null;

  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, status: true, creatorId: true, productId: true, variantId: true },
  });

  if (!videoCanAttribute(video)) return null;

  const now = new Date();
  const expiresAt = expiryFrom(now, config.attributionWindowDays);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.creatorAttribution.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId: video.productId } },
        select: { id: true, videoId: true, touchCount: true },
      });

      const decision = shouldSupersede({ existing, videoId });

      if (decision.create) {
        const attribution = await tx.creatorAttribution.create({
          data: {
            cartId: cart.id,
            videoId,
            creatorId: video.creatorId,
            productId: video.productId,
            variantId: video.variantId,
            viewerId: cart.userId ?? null,
            sessionId: sessionId ?? cart.sessionId ?? null,
            surface,
            shareLinkId,
            status: "ACTIVE",
            attributedAt: now,
            expiresAt,
          },
          select: SELECT,
        });

        await tx.creatorAttributionTouch.create({
          data: { attributionId: attribution.id, videoId, creatorId: video.creatorId, surface, shareLinkId },
        });
        await tx.creatorVideo.update({ where: { id: videoId }, data: { addToCartCount: { increment: 1 } } });

        return attribution;
      }

      // Same video again, or a different one taking over. Either way the touch
      // is recorded and the window is refreshed from now.
      const updated = await tx.creatorAttribution.update({
        where: { id: existing.id },
        data: {
          videoId,
          creatorId: video.creatorId,
          variantId: video.variantId,
          surface,
          shareLinkId,
          status: "ACTIVE",
          attributedAt: now,
          expiresAt,
          touchCount: { increment: 1 },
          viewerId: cart.userId ?? undefined,
        },
        select: SELECT,
      });

      await tx.creatorAttributionTouch.create({
        data: { attributionId: updated.id, videoId, creatorId: video.creatorId, surface, shareLinkId },
      });
      await tx.creatorVideo.update({ where: { id: videoId }, data: { addToCartCount: { increment: 1 } } });

      return updated;
    });
  } catch (error) {
    // Never let attribution break a basket.
    logger.warn("attribution failed on add-to-cart", { cartId: cart.id, videoId, error: error.message });
    return null;
  }
}

/** Live attributions on a cart, for the "this was suggested by @x" line. */
export async function cartAttributions(cartId) {
  return prisma.creatorAttribution.findMany({
    where: { cartId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: SELECT,
  });
}

/**
 * Fills in the viewer when a guest cart is claimed.
 *
 * A guest adds from a video and signs in at checkout. Without this the
 * attribution never learns who bought, and self-purchase — the main abuse this
 * program has to resist — becomes undetectable.
 */
export async function claimAttributions({ cartId, userId }) {
  const result = await prisma.creatorAttribution.updateMany({
    where: { cartId, viewerId: null },
    data: { viewerId: userId },
  });

  return { claimed: result.count };
}

/**
 * Freezes cart attributions onto a placed order.
 *
 * Called inside the checkout transaction. The cart is emptied immediately
 * after, so anything not copied here is lost — and with it the creator's claim
 * on a sale they genuinely drove.
 *
 * Amounts come from the order lines rather than the cart, because the order is
 * what was actually bought and priced.
 */
export async function captureForOrder({ tx, cartId, orderId, buyerUserId }) {
  const attributions = await tx.creatorAttribution.findMany({
    where: { cartId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: {
      id: true,
      videoId: true,
      creatorId: true,
      productId: true,
      variantId: true,
      attributedAt: true,
      creator: { select: { userId: true } },
    },
  });
  if (!attributions.length) return { captured: 0 };

  const orderItems = await tx.orderItem.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    select: { id: true, productId: true, variantId: true, quantity: true, lineTotal: true },
  });

  let captured = 0;

  for (const attribution of attributions) {
    const matched = matchLines({ attribution, orderItems });

    // The viewer removed it before paying. No sale, no attribution.
    if (matched.quantity <= 0) continue;

    await tx.creatorOrderAttribution.create({
      data: {
        orderId,
        orderItemId: matched.orderItemId,
        videoId: attribution.videoId,
        creatorId: attribution.creatorId,
        productId: attribution.productId,
        variantId: attribution.variantId,
        quantity: matched.quantity,
        lineAmount: money(matched.lineAmount),
        isSelfPurchase: isSelfPurchase({
          creatorUserId: attribution.creator?.userId,
          buyerUserId,
        }),
        attributedAt: attribution.attributedAt,
      },
    });

    await tx.creatorAttribution.update({
      where: { id: attribution.id },
      data: { status: "CONVERTED", convertedOrderId: orderId },
    });

    captured += 1;
  }

  return { captured };
}

/** What an order carries, for the admin view and the earnings engine. */
export async function orderAttributions(orderId) {
  return prisma.creatorOrderAttribution.findMany({
    where: { orderId },
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      videoId: true,
      creatorId: true,
      productId: true,
      variantId: true,
      quantity: true,
      lineAmount: true,
      isSelfPurchase: true,
      attributedAt: true,
      creator: { select: { id: true, handle: true, displayName: true, status: true, userId: true } },
      video: { select: { id: true, status: true, caption: true } },
      earning: { select: { id: true, status: true, amount: true, disqualifiedReason: true } },
    },
  });
}

/**
 * Removes an attribution from an order.
 *
 * The fraud lever. Refused once the earning has been credited — clawing money
 * back is the wallet's job, and doing it by deleting the reason the credit
 * exists would leave a balance nobody can explain.
 */
export async function revokeOrderAttribution(id, { reason, actor }) {
  const attribution = await prisma.creatorOrderAttribution.findUnique({
    where: { id },
    select: { id: true, orderId: true, creatorId: true, earning: { select: { id: true, status: true } } },
  });
  if (!attribution) throw ApiError.notFound("Attribution not found");

  if (attribution.earning && ["CREDITED"].includes(attribution.earning.status)) {
    throw ApiError.conflict("That earning has already been credited", {
      hint: "Reverse the earning instead, which claws the credit back",
      earningId: attribution.earning.id,
    });
  }

  await prisma.$transaction(async (tx) => {
    if (attribution.earning) {
      await tx.creatorEarning.update({
        where: { id: attribution.earning.id },
        data: { status: "REJECTED", disqualifiedReason: reason ?? "Revoked by an administrator", reviewedById: actor?.userId ?? null },
      });
    }
    await tx.creatorOrderAttribution.delete({ where: { id } });
  });

  logger.info("order attribution revoked", { id, orderId: attribution.orderId, reason });
  return { id, revoked: true };
}

/**
 * Expires attributions whose window has run out.
 *
 * Run on a schedule. An attribution that outlives its window would credit a
 * creator for a purchase somebody made a month after watching, which is not a
 * sale that video drove.
 */
export async function expireAttributions(now = new Date()) {
  const result = await prisma.creatorAttribution.updateMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });

  return { expired: result.count };
}
