import { z } from "zod";
import { fitsScale } from "@/lib/money-math";
import { cuidSchema } from "@/server/validation/schemas";
import { moneySchema } from "@/server/validation/catalog.schemas";

/**
 * Pricing request schemas — tax groups and rates, promotions, coupons and
 * manual discounts.
 *
 * One rule shapes all of it: **no request here ever names an amount that ends
 * up on an order.** A promotion request describes a rule; a coupon request
 * names a code. What either is worth is computed server-side from the basket.
 * The single exception is a manual discount, which is a human deciding an
 * amount on purpose — and that one is permission-gated, capped and audited.
 */

const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(2000);

/** Minutes from midnight; past 1440 expresses a window running into tomorrow. */
const minuteOfDay = z.number().int().min(0).max(2879);

/** A tax percentage, stored as Decimal(9,4). */
const percentSchema = z
  .number()
  .finite()
  .min(0, "A rate cannot be negative")
  .max(100, "A rate cannot exceed 100%")
  .refine((value) => fitsScale(value, 4), "A rate supports at most 4 decimal places");

// --- tax --------------------------------------------------------------------

export const taxRateSchema = z.object({
  name: shortText,
  rate: percentSchema,
  accountId: cuidSchema.nullish(),
  region: z.string().trim().max(80).nullish(),
  isCompound: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const createTaxGroupSchema = z.object({
  name: shortText,
  isInclusive: z.boolean().optional(),
  isActive: z.boolean().optional(),
  rates: z.array(taxRateSchema).max(10).optional(),
});

export const updateTaxGroupSchema = z
  .object({
    name: shortText.optional(),
    isInclusive: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const updateTaxRateSchema = taxRateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

// --- promotions -------------------------------------------------------------

export const discountTypeSchema = z.enum([
  "PERCENTAGE",
  "FIXED_AMOUNT",
  "FREE_DELIVERY",
  "FREE_ITEM",
  "BUY_X_GET_Y",
  "BUNDLE_PRICE",
]);

export const promotionTargetSchema = z.object({
  targetType: z.enum(["ORDER", "PRODUCT", "VARIANT", "CATEGORY"]),
  targetId: cuidSchema.nullish(),
  isExcluded: z.boolean().optional(),
  /** Which side of a buy-x-get-y this target sits on. */
  role: z.enum(["BUY", "GET"]).nullish(),
});

export const createPromotionSchema = z.object({
  name: shortText,
  description: longText.optional(),
  type: discountTypeSchema,
  value: moneySchema.optional(),
  maxDiscountAmount: moneySchema.nullish(),
  minOrderAmount: moneySchema.nullish(),
  minItemCount: z.number().int().min(1).max(1000).nullish(),
  buyQuantity: z.number().int().min(1).max(100).nullish(),
  getQuantity: z.number().int().min(1).max(100).nullish(),
  branchIds: z.array(cuidSchema).max(200).optional(),
  channels: z.array(z.enum(["WEB", "MOBILE_APP", "QR", "POS", "PHONE", "AGGREGATOR"])).optional(),
  orderTypes: z.array(z.enum(["DELIVERY", "PICKUP", "DINE_IN"])).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startMinute: minuteOfDay.nullish(),
  endMinute: minuteOfDay.nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  newCustomersOnly: z.boolean().optional(),
  isStackable: z.boolean().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  usageLimit: z.number().int().min(1).max(10_000_000).nullish(),
  usageLimitPerUser: z.number().int().min(1).max(1000).nullish(),
  requiresCoupon: z.boolean().optional(),
  isActive: z.boolean().optional(),
  targets: z.array(promotionTargetSchema).max(500).optional(),
});

export const updatePromotionSchema = createPromotionSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listPromotionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  isActive: z.stringbool().optional(),
  type: discountTypeSchema.optional(),
  branchId: cuidSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const setPromotionActiveSchema = z.object({ isActive: z.boolean() });

// --- coupons ----------------------------------------------------------------

/**
 * Codes are typed off flyers and read down phone lines, so the alphabet is
 * restricted to what survives that: letters, digits, dash and underscore. Case
 * is normalised by the service rather than rejected here — `save20` is not a
 * mistake worth an error message.
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(3, "A code must be at least 3 characters")
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "A code can only contain letters, numbers, dashes and underscores");

export const createCouponSchema = z.object({
  code: couponCodeSchema,
  promotionId: cuidSchema,
  description: longText.optional(),
  assignedToId: cuidSchema.nullish(),
  maxRedemptions: z.number().int().min(1).max(10_000_000).nullish(),
  maxRedemptionsPerUser: z.number().int().min(1).max(1000).nullish(),
  startsAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
  isActive: z.boolean().optional(),
  campaign: z.string().trim().max(80).nullish(),
});

export const updateCouponSchema = createCouponSchema
  .partial()
  .omit({ promotionId: true })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

/**
 * Bulk generation is capped at 10,000 per call. It is a synchronous request, and
 * a batch large enough to hold a transaction open for minutes belongs in a job,
 * not in an HTTP handler.
 */
export const generateCouponsSchema = z.object({
  promotionId: cuidSchema,
  count: z.number().int().min(1).max(10_000),
  prefix: z
    .string()
    .trim()
    .max(12)
    .regex(/^[A-Za-z0-9_-]*$/, "A prefix can only contain letters, numbers, dashes and underscores")
    .optional(),
  length: z.number().int().min(4).max(16).default(8),
  campaign: z.string().trim().min(1).max(80).optional(),
  maxRedemptions: z.number().int().min(1).max(10_000_000).nullish(),
  maxRedemptionsPerUser: z.number().int().min(1).max(1000).nullish(),
  startsAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
});

export const listCouponsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  promotionId: cuidSchema.optional(),
  campaign: z.string().trim().min(1).max(80).optional(),
  isActive: z.stringbool().optional(),
  search: z.string().trim().min(1).max(40).optional(),
});

export const applyCouponSchema = z.object({ code: couponCodeSchema });

export const validateCouponSchema = z.object({ code: couponCodeSchema });

export const revokeCampaignSchema = z.object({ campaign: z.string().trim().min(1).max(80) });

// --- manual discounts -------------------------------------------------------

/**
 * Exactly one of `amount` or `percent`. A till that accepts "20" without saying
 * which is a till that eventually gives away 20% instead of 20 rupees.
 */
export const manualDiscountSchema = z
  .object({
    amount: moneySchema.positive().optional(),
    percent: z.number().finite().min(0.01).max(100).optional(),
    reason: z.string().trim().min(3, "Say why this discount was given").max(500),
    label: shortText.optional(),
  })
  .refine(
    (value) => (value.amount == null) !== (value.percent == null),
    "Give either an amount or a percentage, not both",
  );
