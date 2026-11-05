import { z } from "zod";
import { cuidSchema, nameSchema, phoneSchema, emailSchema } from "@/server/validation/schemas";
import { moneySchema } from "@/server/validation/catalog.schemas";
import { couponCodeSchema } from "@/server/validation/pricing.schemas";

/**
 * Carts, checkout, orders, the kitchen display, invoices and reviews.
 *
 * Notice what is **absent**: no schema here accepts a price, a total or a
 * discount amount from the client. A cart line is a product, a variant, a
 * quantity and some choices; the money is resolved server-side from the menu.
 * Anything else would let a mobile binary — which the user fully controls —
 * decide what it pays. A coupon *code* is the one apparent exception, and it is
 * not one: the code is a name, and what it is worth is looked up server-side.
 */

export const orderTypeSchema = z.enum(["DELIVERY", "PICKUP", "DINE_IN"]);
export const orderChannelSchema = z.enum(["WEB", "MOBILE_APP", "QR", "POS", "PHONE", "AGGREGATOR"]);
export const orderStatusSchema = z.enum([
  "DRAFT",
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "REFUNDED",
]);
export const orderItemStatusSchema = z.enum(["QUEUED", "PREPARING", "READY", "SERVED", "CANCELLED"]);
export const paymentStateSchema = z.enum([
  "UNPAID",
  "AUTHORIZED",
  "PARTIALLY_PAID",
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "FAILED",
]);

const quantity = z.number().int().min(1).max(99);

export const modifierSelectionSchema = z.object({
  optionId: cuidSchema,
  quantity: z.number().int().min(1).max(20).default(1),
});

export const comboSelectionSchema = z.object({
  groupId: cuidSchema,
  productId: cuidSchema,
  variantId: cuidSchema.nullish(),
  /**
   * How many portions this choice is worth, when the client is overriding.
   *
   * Deliberately optional rather than `.default(1)`. The catalog already says
   * what one of these is — a "2 burgers" slot option carries `quantity: 2` —
   * and a default here silently replaced that with 1 before the service ever
   * saw it, so a two-portion option could never satisfy the two-portion slot
   * it was built for. It failed as `Choose at least 2 from "Burgers"`, which
   * reads like a customer mistake rather than a dropped field.
   */
  quantity: z.number().int().min(1).max(20).optional(),
  /**
   * How the chosen item is made — "no onions" on the burger inside a meal.
   *
   * The same shape a line's own modifiers take, because a combo choice is a
   * product and is resolved against its own attached groups. Undeclared, this
   * field was silently dropped before it reached the service, which is the
   * quiet kind of failure: the order looks accepted and the kitchen never
   * hears about it.
   */
  modifiers: z.array(modifierSelectionSchema).max(30).default([]),
});

// --- cart -------------------------------------------------------------------

export const addCartItemSchema = z.object({
  productId: cuidSchema,
  variantId: cuidSchema.nullish(),
  quantity: quantity.default(1),
  notes: z.string().trim().max(300).nullish(),
  modifiers: z.array(modifierSelectionSchema).max(30).default([]),
  comboSelections: z.array(comboSelectionSchema).max(20).default([]),
  /** Adding from a branch page sets the cart's context in the same call. */
  branchId: cuidSchema.optional(),
  type: orderTypeSchema.optional(),
  /**
   * Where this add-to-cart came from, when it came from a creator's video.
   *
   * Pressing add-to-cart on a video is the *only* thing that creates an
   * attribution — watching one never does — so without these the creator
   * programme earns nothing from the website or the app at all. The service
   * has always handled them; they were missing here, and an undeclared field
   * is stripped before it ever arrives, which made that branch unreachable.
   */
  creatorVideoId: cuidSchema.optional(),
  creatorSurface: z.enum(["PRODUCT_PAGE", "VIDEO_FEED", "SHARE_LINK", "SEARCH", "HOME", "QR_MENU"]).optional(),
  creatorShareLinkId: cuidSchema.optional(),
});

export const updateCartItemSchema = z
  .object({
    // 0 removes the line, which is what a stepper control sends at its minimum.
    quantity: z.number().int().min(0).max(99).optional(),
    notes: z.string().trim().max(300).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const cartContextSchema = z
  .object({
    branchId: cuidSchema.nullish(),
    type: orderTypeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide a branch or an order type");

// --- checkout ---------------------------------------------------------------

export const guestSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
});

export const checkoutSchema = z.object({
  branchId: cuidSchema.optional(),
  type: orderTypeSchema.optional(),
  addressId: cuidSchema.optional(),
  tableId: cuidSchema.optional(),
  guestCount: z.number().int().min(1).max(50).optional(),
  customerNote: z.string().trim().max(500).nullish(),
  /** A tip is the one amount a customer legitimately chooses. */
  tipAmount: moneySchema.default(0),
  guest: guestSchema.optional(),
  /**
   * Overrides the code sitting on the cart. Only the *code* is ever accepted —
   * what it is worth is computed server-side from the live rules.
   */
  couponCode: couponCodeSchema.optional(),
  /**
   * Which gateway the customer chose to pay with, now.
   *
   * Absent means "settle in person" — at the counter or at the door — which
   * stays the default. Only the gateway's *name* is accepted, and the service
   * checks it against the ones this branch actually switched on, so a name a
   * customer invents cannot conjure a payment route.
   */
  payWith: z.string().trim().min(2).max(40).optional(),
});

export const quoteSchema = z.object({
  branchId: cuidSchema,
  type: orderTypeSchema.default("DELIVERY"),
  items: z
    .array(
      z.object({
        productId: cuidSchema,
        variantId: cuidSchema.nullish(),
        quantity,
        modifiers: z.array(modifierSelectionSchema).max(30).default([]),
        comboSelections: z.array(comboSelectionSchema).max(20).default([]),
      }),
    )
    .min(1)
    .max(100),
  tipAmount: moneySchema.default(0),
  couponCode: couponCodeSchema.optional(),
});

/** Staff order entry: counter, phone and table orders. */
export const staffOrderSchema = z.object({
  branchId: cuidSchema,
  type: orderTypeSchema.default("DINE_IN"),
  channel: orderChannelSchema.default("POS"),
  items: quoteSchema.shape.items,
  /** Attach the order to an existing customer, or capture a walk-in's details. */
  userId: cuidSchema.optional(),
  /**
   * Required for a staff-placed DELIVERY order — a phone order taken for a
   * customer who already has a saved address, which is the whole point of
   * `channel: "PHONE"`. The address must belong to `userId`; the service
   * checks that rather than trusting the pairing.
   */
  addressId: cuidSchema.optional(),
  guest: guestSchema.partial({ phone: true }).optional(),
  tableId: cuidSchema.optional(),
  guestCount: z.number().int().min(1).max(50).optional(),
  customerNote: z.string().trim().max(500).nullish(),
  kitchenNote: z.string().trim().max(500).nullish(),
  tipAmount: moneySchema.default(0),
  couponCode: couponCodeSchema.optional(),
});

// --- orders -----------------------------------------------------------------

export const orderQuerySchema = z.object({
  branchId: cuidSchema.optional(),
  status: orderStatusSchema.optional(),
  type: orderTypeSchema.optional(),
  channel: orderChannelSchema.optional(),
  paymentState: paymentStateSchema.optional(),
  search: z.string().trim().min(1).max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const myOrderQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export const changeStatusSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(300).nullish(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, "Say why it is being cancelled").max(300),
});

export const orderNotesSchema = z
  .object({
    kitchenNote: z.string().trim().max(500).nullish(),
    customerNote: z.string().trim().max(500).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one note");

export const trackQuerySchema = z.object({
  /** A guest proves the order is theirs with the phone number on it. */
  phone: z.string().trim().min(4).max(20).optional(),
});

export const orderNumberParamSchema = z.object({
  orderNumber: z.string().trim().min(3).max(60),
});

// --- kitchen display --------------------------------------------------------

export const kdsQuerySchema = z.object({
  branchId: cuidSchema,
  stationId: cuidSchema.optional(),
  includeReady: z.stringbool().default(true),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const itemStatusSchema = z.object({
  status: orderItemStatusSchema,
  reason: z.string().trim().max(300).nullish(),
});

/**
 * Bumping a ticket.
 *
 * `stationId` scopes it to one station's lines. Without it the grill, looking
 * at a board filtered to the grill and showing a single burger, marked the
 * pizza still in the oven ready as well — and took the whole order to READY
 * with it. The button said "All ready" and meant every line on the order, not
 * every line on the screen.
 */
export const bumpSchema = z.object({
  /**
   * SERVED is here because the pass bumps too. A waiter carrying a tray out is
   * doing to a round exactly what a cook does when they finish it — clearing
   * every line on one ticket in one tap — and giving that its own endpoint
   * would be two implementations of one idea.
   */
  status: z.enum(["PREPARING", "READY", "SERVED"]).default("READY"),
  stationId: cuidSchema.nullish(),
  /** Which round of the meal. Absent means the whole order, as it always did. */
  course: z.number().int().min(1).max(50).nullish(),
});

/**
 * A second round, added to an order that is already on a table.
 *
 * The same line shape the counter sends when it takes the order in the first
 * place — a round added later is not a different kind of sale, and giving it
 * its own shape would be two parsers for one thing to keep in step.
 */
export const addCourseSchema = z.object({
  items: quoteSchema.shape.items,
});

/**
 * Setting a ticket aside.
 *
 * The reason is required and has a floor, because the whole value of this is
 * that the next person knows what they are looking at. "Walked off" and
 * "duplicate of 0042" lead to different decisions; an empty string leads to a
 * phone call.
 */
export const setAsideSchema = z.object({
  reason: z.string().trim().min(3, "Say what is wrong with it").max(300),
});

export const branchQuerySchema = z.object({ branchId: cuidSchema });

// --- invoices ---------------------------------------------------------------

export const issueInvoiceSchema = z.object({
  name: z.string().trim().max(120).optional(),
  taxId: z.string().trim().max(60).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Say why it is being voided").max(300),
});

// --- reviews ----------------------------------------------------------------

export const submitReviewSchema = z.object({
  orderId: cuidSchema,
  productId: cuidSchema.nullish(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).nullish(),
});

export const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide a rating or a comment");

export const moderateReviewSchema = z.object({
  status: z.enum(["PUBLISHED", "REJECTED"]),
});

export const reviewQuerySchema = z.object({
  status: z.enum(["PENDING", "PUBLISHED", "REJECTED"]).optional(),
  productId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
