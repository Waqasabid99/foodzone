import { Prisma } from "@/generated/prisma";

/**
 * Attribution rules.
 *
 * Pure. The whole question this module answers is "whose video sold this", and
 * getting it wrong pays the wrong person — which is worse than paying nobody,
 * because the creator who actually drove the sale watches somebody else get
 * credited for it.
 *
 * Four decisions, each the opposite of the obvious one:
 *
 *   * **A view attributes nothing.** Only pressing add-to-cart from a video
 *     creates an attribution. Attributing on view means a product page with
 *     six videos on it credits all six for a sale that any of them, or none of
 *     them, caused — and the creator whose video is at the top of the list wins
 *     every time regardless of whether anybody watched it.
 *   * **Last touch wins.** If a viewer adds a pizza from one video, empties the
 *     cart, and adds it again from another, the second video gets it. It is the
 *     one that actually converted. The overwritten touch is kept, so the
 *     decision is auditable rather than simply lost.
 *   * **Attribution is per product, not per cart.** A cart with a pizza from
 *     one video and a burger from another credits both creators, each for their
 *     own line. One attribution per cart would make the second creator's video
 *     worthless.
 *   * **The window is checked against the touch, not the order.** A viewer who
 *     adds to cart today and checks out in three weeks is outside the window,
 *     even though the order is new.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

export function expiryFrom(attributedAt, windowDays) {
  const base = attributedAt ? new Date(attributedAt) : new Date();
  return new Date(base.getTime() + Math.max(1, Number(windowDays ?? 7)) * 86_400_000);
}

export function isWithinWindow(attribution, at = new Date()) {
  if (!attribution?.expiresAt) return false;
  return new Date(attribution.expiresAt) > new Date(at);
}

/**
 * Whether an existing attribution should be replaced by a new touch.
 *
 * The same video touching again is not a new attribution — it refreshes the
 * window and bumps the touch count. A *different* video supersedes.
 */
export function shouldSupersede({ existing, videoId }) {
  if (!existing) return { create: true, supersede: false, refresh: false };
  if (existing.videoId === videoId) return { create: false, supersede: false, refresh: true };
  return { create: false, supersede: true, refresh: false };
}

/**
 * Whether a video is eligible to earn an attribution at all.
 *
 * A video taken down after a viewer added to cart keeps its attribution — the
 * sale genuinely happened because of it — but a video that was never live
 * cannot have driven anything.
 */
export function videoCanAttribute(video) {
  return video?.status === "APPROVED";
}

/**
 * Whether a video may still earn on an already-placed order.
 *
 * A takedown for something like poor quality does not retroactively unsell the
 * food. A takedown for fraud does, and that is expressed by revoking the
 * attribution explicitly rather than by inferring it from the video's status —
 * so this deliberately does not consult the status.
 */
export function attributionCanEarn(attribution) {
  return attribution?.status === "CONVERTED";
}

/**
 * Which lines on an order an attribution covers, and for how much.
 *
 * The viewer is free to change quantity or variant between watching and paying,
 * so the earning is computed from what was actually bought rather than from
 * what the video showed. A variant-specific attribution still matches the
 * product: somebody who watched a video of the large pizza and bought the small
 * one was still sold a pizza by that video.
 */
export function matchLines({ attribution, orderItems }) {
  const matching = orderItems.filter((item) => item.productId === attribution.productId);
  if (!matching.length) return { quantity: 0, lineAmount: D(0), orderItemId: null };

  // Prefer the exact variant when the attribution names one, so the amount is
  // the line the viewer actually saw where possible.
  const exact = attribution.variantId
    ? matching.filter((item) => item.variantId === attribution.variantId)
    : [];
  const lines = exact.length ? exact : matching;

  const quantity = lines.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  const lineAmount = lines.reduce((sum, item) => sum.plus(D(item.lineTotal ?? item.totalAmount ?? 0)), D(0));

  return { quantity, lineAmount, orderItemId: lines[0]?.id ?? null };
}

/** A creator buying through their own video, which is blocked by default. */
export function isSelfPurchase({ creatorUserId, buyerUserId }) {
  return Boolean(creatorUserId) && creatorUserId === buyerUserId;
}
