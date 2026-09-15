import { z } from "zod";
import { cuidSchema, phoneSchema } from "@/server/validation/schemas";
import { moneySchema } from "@/server/validation/catalog.schemas";

/**
 * Driver, delivery and payout request schemas.
 *
 * The rule that shapes these: a driver's app is software on a phone the driver
 * controls, so nothing it sends about **money or identity** is trusted. It may
 * report where it is and what happened at the door; it may not name its own
 * earning, mark a different driver's job, or decide how much cash it collected
 * beyond what the order actually owes.
 */

export const driverStatusSchema = z.enum(["OFFLINE", "AVAILABLE", "ON_DELIVERY", "ON_BREAK", "SUSPENDED"]);

export const vehicleTypeSchema = z.enum(["BICYCLE", "MOTORCYCLE", "SCOOTER", "CAR", "VAN", "ON_FOOT"]);

export const deliveryStatusSchema = z.enum([
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "REJECTED",
  "ARRIVED_AT_STORE",
  "PICKED_UP",
  "ON_THE_WAY",
  "ARRIVED",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
]);

/** WGS84 bounds. A wrong-way-round lat/lng is a bug worth catching at the edge. */
const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);

// --- drivers ----------------------------------------------------------------

export const createDriverSchema = z.object({
  userId: cuidSchema,
  branchId: cuidSchema.nullish(),
  employeeId: cuidSchema.nullish(),
  vehicleType: vehicleTypeSchema.default("MOTORCYCLE"),
  vehicleNumber: z.string().trim().max(40).nullish(),
  licenseNumber: z.string().trim().max(60).nullish(),
  licenseExpiry: z.coerce.date().nullish(),
  maxActiveOrders: z.number().int().min(1).max(20).optional(),
  payoutPerDelivery: moneySchema.nullish(),
  isActive: z.boolean().optional(),
});

export const updateDriverSchema = createDriverSchema
  .partial()
  .omit({ userId: true })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

/** Staff may set any status; the driver's own endpoint narrows this further. */
export const setDriverStatusSchema = z.object({ status: driverStatusSchema });

export const driverAvailabilitySchema = z.object({
  status: z.enum(["AVAILABLE", "ON_BREAK", "OFFLINE"]),
});

export const listDriversSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  status: driverStatusSchema.optional(),
  isActive: z.stringbool().optional(),
  available: z.stringbool().optional(),
});

export const locationSchema = z.object({
  latitude,
  longitude,
  heading: z.number().finite().min(0).max(360).nullish(),
  accuracy: z.number().finite().min(0).max(100_000).nullish(),
  speedKph: z.number().finite().min(0).max(400).nullish(),
  recordedAt: z.coerce.date().optional(),
});

export const startShiftSchema = z
  .object({ branchId: cuidSchema.optional() })
  .optional()
  .default({});

export const endShiftSchema = z.object({ cashHandedOver: moneySchema.default(0) });

// --- deliveries -------------------------------------------------------------

export const createDeliverySchema = z.object({ orderId: cuidSchema });

export const assignDriverSchema = z.object({
  driverId: cuidSchema,
  reassign: z.boolean().default(false),
});

export const unassignSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .optional()
  .default({});

/**
 * A status update from dispatch or from the driver app.
 *
 * `collectedCod` is capped server-side at what the order actually owes, so a
 * driver cannot record collecting more than the bill; and there is no field for
 * a driver's earning, because that is not theirs to declare.
 */
export const setDeliveryStatusSchema = z.object({
  status: deliveryStatusSchema,
  handoverCode: z.string().trim().regex(/^\d{4,10}$/, "Enter the code the customer gives you").optional(),
  proofImageUrl: z.url().max(2000).optional(),
  recipientName: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(500).optional(),
  collectedCod: moneySchema.optional(),
});

export const listDeliveriesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  driverId: cuidSchema.optional(),
  status: deliveryStatusSchema.optional(),
  unassigned: z.stringbool().optional(),
});

// --- payouts ----------------------------------------------------------------

export const generatePayoutSchema = z.object({
  driverId: cuidSchema,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  /** Bonuses and penalties. Negative is allowed; this is the one signed field. */
  adjustmentAmount: z
    .number()
    .finite()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => Number.isInteger(value * 10_000), "Supports at most 4 decimal places")
    .optional(),
});

export const generatePayoutRunSchema = z.object({
  branchId: cuidSchema.optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

export const markPaidSchema = z
  .object({ paymentReference: z.string().trim().max(120).optional() })
  .optional()
  .default({});

export const listPayoutsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  driverId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "APPROVED", "PAID", "CANCELLED"]).optional(),
});
