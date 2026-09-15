import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";

/**
 * Inventory and procurement request schemas.
 *
 * Quantities are `Decimal(18,6)` and costs `Decimal(18,6)`, so both are checked
 * to six decimal places here rather than being silently rounded by Postgres.
 *
 * One rule runs through the whole module: **a request never states a document
 * total.** A purchase order says what is being bought and at what unit price;
 * the subtotal, tax and grand total are derived server-side. A client that can
 * name a total is a client that can order ten thousand of something and claim
 * it cost nothing.
 */

const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(2000);

/** A physical quantity. Six decimal places, matching the column. */
export const quantitySchema = z
  .number()
  .finite()
  .min(-999_999_999)
  .max(999_999_999)
  .refine((value) => Number.isInteger(Math.round(value * 1_000_000)), "Supports at most 6 decimal places");

export const positiveQuantitySchema = quantitySchema.refine((value) => value > 0, "Must be greater than zero");

export const costSchema = z
  .number()
  .finite()
  .min(0)
  .max(999_999_999)
  .refine((value) => Number.isInteger(Math.round(value * 1_000_000)), "Supports at most 6 decimal places");

// --- units ------------------------------------------------------------------

export const uomTypeSchema = z.enum(["WEIGHT", "VOLUME", "COUNT", "LENGTH", "TIME"]);

export const createUnitSchema = z.object({
  code: z.string().trim().min(1).max(12),
  name: shortText,
  type: uomTypeSchema,
  baseUnitId: cuidSchema.nullish(),
  /** How many base units are in one of this unit. kg -> g is 1000. */
  factor: z.number().finite().positive().max(1_000_000_000).optional(),
  precision: z.number().int().min(0).max(6).optional(),
  isActive: z.boolean().optional(),
});

export const updateUnitSchema = createUnitSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const inventoryCategorySchema = z.object({
  name: shortText,
  code: z.string().trim().max(20).nullish(),
  isActive: z.boolean().optional(),
});

// --- items ------------------------------------------------------------------

export const itemTypeSchema = z.enum([
  "RAW_MATERIAL",
  "SEMI_FINISHED",
  "FINISHED_GOOD",
  "PACKAGING",
  "CONSUMABLE",
]);

export const createItemSchema = z.object({
  sku: z.string().trim().max(40).optional(),
  name: shortText,
  description: longText.optional(),
  type: itemTypeSchema.default("RAW_MATERIAL"),
  categoryId: cuidSchema.nullish(),
  uomId: cuidSchema,
  barcode: z.string().trim().max(60).nullish(),
  imageUrl: z.url().max(2000).nullish(),
  costingMethod: z.enum(["FIFO", "WEIGHTED_AVERAGE"]).optional(),
  isPerishable: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(1).max(3650).nullish(),
  reorderLevel: costSchema.nullish(),
  reorderQuantity: costSchema.nullish(),
  /** Usable proportion after prep loss: 80 means 1kg yields 800g. */
  yieldPercent: z.number().finite().min(1).max(100).optional(),
  taxGroupId: cuidSchema.nullish(),
  isActive: z.boolean().optional(),
});

export const updateItemSchema = createItemSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listItemsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  type: itemTypeSchema.optional(),
  categoryId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  isActive: z.stringbool().optional(),
  lowStock: z.stringbool().optional(),
});

// --- locations --------------------------------------------------------------

export const locationTypeSchema = z.enum([
  "MAIN_STORE",
  "KITCHEN",
  "COLD_STORAGE",
  "BAR",
  "COUNTER",
  "WASTE",
]);

export const createLocationSchema = z.object({
  branchId: cuidSchema,
  name: shortText,
  code: z.string().trim().min(1).max(20),
  type: locationTypeSchema.default("MAIN_STORE"),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateLocationSchema = createLocationSchema
  .partial()
  .omit({ branchId: true })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

// --- stock reads ------------------------------------------------------------

export const stockQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  itemId: cuidSchema.optional(),
  categoryId: cuidSchema.optional(),
  lowOnly: z.stringbool().optional(),
});

export const movementQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  itemId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  orderId: cuidSchema.optional(),
  type: z
    .enum([
      "PURCHASE_IN",
      "PRODUCTION_IN",
      "PRODUCTION_OUT",
      "SALE_OUT",
      "TRANSFER_IN",
      "TRANSFER_OUT",
      "ADJUSTMENT_IN",
      "ADJUSTMENT_OUT",
      "WASTAGE",
      "RETURN_TO_SUPPLIER",
      "CUSTOMER_RETURN",
      "OPENING_BALANCE",
      "COUNT_CORRECTION",
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const batchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  itemId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  status: z.enum(["ACTIVE", "DEPLETED", "EXPIRED", "QUARANTINED"]).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const setBatchStatusSchema = z.object({
  status: z.enum(["ACTIVE", "QUARANTINED"]),
  notes: longText.optional(),
});

export const writeOffBatchSchema = z.object({
  reason: z
    .enum(["EXPIRED", "SPOILED", "DAMAGED", "OVER_PRODUCTION", "COOKING_ERROR", "SPILLAGE", "THEFT", "OTHER"])
    .default("EXPIRED"),
  notes: longText.optional(),
});

// --- suppliers --------------------------------------------------------------

export const createSupplierSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: shortText,
  contactPerson: z.string().trim().max(80).nullish(),
  email: z.email().max(254).nullish(),
  phone: z.string().trim().max(20).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().max(80).nullish(),
  country: z.string().trim().max(80).nullish(),
  postalCode: z.string().trim().max(12).nullish(),
  taxIdentifier: z.string().trim().max(60).nullish(),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  creditLimit: costSchema.nullish(),
  rating: z.number().int().min(1).max(5).nullish(),
  notes: longText.nullish(),
  isActive: z.boolean().optional(),
});

export const updateSupplierSchema = createSupplierSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const supplierItemSchema = z.object({
  itemId: cuidSchema,
  supplierSku: z.string().trim().max(60).nullish(),
  uomId: cuidSchema.optional(),
  unitPrice: costSchema,
  minOrderQuantity: costSchema.nullish(),
  leadTimeDays: z.number().int().min(0).max(365).nullish(),
  isPreferred: z.boolean().optional(),
});

// --- purchase orders --------------------------------------------------------

const poLineSchema = z.object({
  itemId: cuidSchema,
  quantity: positiveQuantitySchema,
  uomId: cuidSchema.optional(),
  /** Omitted, the supplier's agreed price is used. */
  unitPrice: costSchema.optional(),
  taxRate: z.number().finite().min(0).max(100).optional(),
  discountAmount: costSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const createPurchaseOrderSchema = z.object({
  branchId: cuidSchema,
  supplierId: cuidSchema,
  expectedAt: z.coerce.date().nullish(),
  shippingCost: costSchema.optional(),
  notes: longText.nullish(),
  items: z.array(poLineSchema).min(1).max(200),
});

export const updatePurchaseOrderSchema = z.object({
  expectedAt: z.coerce.date().nullish(),
  shippingCost: costSchema.optional(),
  notes: longText.nullish(),
  items: z.array(poLineSchema).min(1).max(200).optional(),
});

export const listPurchaseOrdersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  supplierId: cuidSchema.optional(),
  status: z
    .enum([
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT",
      "PARTIALLY_RECEIVED",
      "RECEIVED",
      "CANCELLED",
      "CLOSED",
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const closePurchaseOrderSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .optional()
  .default({});

// --- goods receipts ---------------------------------------------------------

const grnLineSchema = z.object({
  itemId: cuidSchema,
  purchaseOrderItemId: cuidSchema.optional(),
  quantity: positiveQuantitySchema,
  /** Delivered but failed inspection. Never enters stock. */
  rejectedQuantity: quantitySchema.min(0).optional(),
  uomId: cuidSchema.optional(),
  unitCost: costSchema.optional(),
  taxRate: z.number().finite().min(0).max(100).optional(),
  batchNumber: z.string().trim().max(60).optional(),
  expiryDate: z.coerce.date().nullish(),
  notes: z.string().trim().max(500).optional(),
});

export const createGoodsReceiptSchema = z.object({
  locationId: cuidSchema,
  supplierId: cuidSchema,
  purchaseOrderId: cuidSchema.optional(),
  supplierInvoiceNumber: z.string().trim().max(60).nullish(),
  receivedAt: z.coerce.date().optional(),
  /** Freight and handling, spread across the lines by value. */
  landedCost: costSchema.optional(),
  notes: longText.nullish(),
  items: z.array(grnLineSchema).min(1).max(200),
});

export const listGoodsReceiptsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  supplierId: cuidSchema.optional(),
  purchaseOrderId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]).optional(),
});

// --- transfers --------------------------------------------------------------

export const createTransferSchema = z.object({
  fromLocationId: cuidSchema,
  toLocationId: cuidSchema,
  notes: longText.nullish(),
  items: z
    .array(
      z.object({
        itemId: cuidSchema,
        batchId: cuidSchema.optional(),
        quantitySent: positiveQuantitySchema,
      }),
    )
    .min(1)
    .max(200),
});

export const receiveTransferSchema = z
  .object({
    lines: z
      .array(z.object({ transferItemId: cuidSchema, quantityReceived: quantitySchema.min(0) }))
      .max(200)
      .optional(),
  })
  .optional()
  .default({});

export const listTransfersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  fromLocationId: cuidSchema.optional(),
  toLocationId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]).optional(),
});

// --- counts -----------------------------------------------------------------

export const startCountSchema = z.object({
  locationId: cuidSchema,
  itemIds: z.array(cuidSchema).max(1000).optional(),
  categoryId: cuidSchema.optional(),
  scope: z.string().trim().max(120).optional(),
});

export const submitCountSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: cuidSchema,
        countedQuantity: quantitySchema.min(0),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(1000),
  notes: longText.optional(),
});

export const listCountsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]).optional(),
});

// --- adjustments and wastage ------------------------------------------------

export const createAdjustmentSchema = z.object({
  locationId: cuidSchema,
  reason: z.string().trim().min(3, "Say why this adjustment is needed").max(500),
  items: z
    .array(
      z.object({
        itemId: cuidSchema,
        /** Signed: positive adds stock, negative removes it. */
        quantity: quantitySchema,
        unitCost: costSchema.optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const wastageReasonSchema = z.enum([
  "EXPIRED",
  "SPOILED",
  "DAMAGED",
  "OVER_PRODUCTION",
  "COOKING_ERROR",
  "CUSTOMER_RETURN",
  "SPILLAGE",
  "THEFT",
  "OTHER",
]);

export const recordWastageSchema = z.object({
  itemId: cuidSchema,
  locationId: cuidSchema,
  quantity: positiveQuantitySchema,
  reason: wastageReasonSchema,
  notes: longText.optional(),
  photoUrl: z.url().max(2000).nullish(),
  occurredAt: z.coerce.date().optional(),
});

export const listWastageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  branchId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  itemId: cuidSchema.optional(),
  reason: wastageReasonSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const reportRangeSchema = z.object({
  branchId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
