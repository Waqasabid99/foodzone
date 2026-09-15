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
  quantity: z.number().int().min(1).max(20).default(1),
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

export const bumpSchema = z.object({
  status: z.enum(["PREPARING", "READY"]).default("READY"),
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
  rating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
