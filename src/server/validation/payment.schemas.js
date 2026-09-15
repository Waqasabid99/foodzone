import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";
import { moneySchema } from "@/server/validation/catalog.schemas";

/**
 * Payment, refund and cash-register request schemas.
 *
 * The rule from the ordering schemas holds here too, with one deliberate
 * exception. A **charge** never names its own amount unless it is a split
 * payment, and even then the server caps it at what the order still owes. A
 * **refund** and a **cash count** do name amounts, because both are humans
 * asserting something about the physical world — and both are permission-gated
 * and audited rather than trusted.
 */

export const paymentMethodSchema = z.enum([
  "CASH",
  "CASH_ON_DELIVERY",
  "CARD",
  "UPI",
  "NET_BANKING",
  "WALLET",
  "BANK_TRANSFER",
  "GIFT_CARD",
  "STORE_CREDIT",
  "AGGREGATOR",
  "OTHER",
]);

export const paymentStatusSchema = z.enum([
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

export const refundStatusSchema = z.enum([
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "REJECTED",
]);

/**
 * A client-generated key that makes "charge this order" safe to retry.
 * Constrained rather than free text so it cannot be used as a smuggling channel.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "An idempotency key must be at least 8 characters")
  .max(120)
  .regex(/^[A-Za-z0-9_:.-]+$/, "An idempotency key can only contain letters, numbers, - _ : and .");

export const createPaymentSchema = z.object({
  orderId: cuidSchema,
  method: paymentMethodSchema,
  provider: z.string().trim().min(2).max(40).optional(),
  /** Omit to charge the full outstanding balance. Present only for split bills. */
  amount: moneySchema.positive().optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
  returnUrl: z.url().max(2000).optional(),
  registerSessionId: cuidSchema.optional(),
});

export const capturePaymentSchema = z
  .object({ amount: moneySchema.positive().optional() })
  .optional()
  .default({});

export const markCollectedSchema = z
  .object({ registerSessionId: cuidSchema.optional() })
  .optional()
  .default({});

export const voidPaymentSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .optional()
  .default({});

export const listPaymentsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  orderId: cuidSchema.optional(),
  status: paymentStatusSchema.optional(),
  method: paymentMethodSchema.optional(),
  provider: z.string().trim().min(2).max(40).optional(),
});

// --- refunds ----------------------------------------------------------------

export const requestRefundSchema = z.object({
  paymentId: cuidSchema,
  /** Omit to refund everything still available on that payment. */
  amount: moneySchema.positive().optional(),
  reason: z.string().trim().min(3, "Say why this refund is being given").max(500),
});

export const rejectRefundSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .optional()
  .default({});

export const listRefundsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  status: refundStatusSchema.optional(),
  orderId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
});

// --- cash registers ---------------------------------------------------------

export const cashMovementTypeSchema = z.enum([
  "SALE",
  "REFUND",
  "PAY_IN",
  "PAY_OUT",
  "DROP",
  "TIP_OUT",
  "ADJUSTMENT",
]);

export const openSessionSchema = z.object({
  branchId: cuidSchema,
  registerName: z.string().trim().min(1).max(40).default("main"),
  openingFloat: moneySchema.default(0),
});

/**
 * Closing requires the counted figure. There is no default: a session closed
 * without a count has no variance, which is the same as not having counted.
 */
export const closeSessionSchema = z.object({
  countedCash: moneySchema,
  notes: z.string().trim().max(1000).optional(),
});

export const reconcileSessionSchema = z
  .object({ notes: z.string().trim().max(1000).optional() })
  .optional()
  .default({});

export const recordMovementSchema = z.object({
  type: cashMovementTypeSchema,
  /** Always positive; the sign is decided from `type` server-side. */
  amount: moneySchema.positive(),
  reason: z.string().trim().max(500).optional(),
  referenceType: z.string().trim().max(40).optional(),
  referenceId: cuidSchema.optional(),
});

export const listSessionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  status: z.enum(["OPEN", "CLOSED", "RECONCILED"]).optional(),
});

// --- webhooks ---------------------------------------------------------------

export const listWebhookEventsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  provider: z.string().trim().min(2).max(40).optional(),
  status: z.enum(["RECEIVED", "PROCESSED", "FAILED", "IGNORED"]).optional(),
});
