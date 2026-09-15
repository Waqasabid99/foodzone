import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";

/**
 * Dine-in surface: tables, QR codes and the public scan endpoint.
 */

const tableName = z.string().trim().min(1).max(40);
const areaName = z.string().trim().min(1).max(60);

export const qrTargetTypeSchema = z.enum(["MENU", "TABLE", "CATEGORY", "PRODUCT", "CUSTOM_URL"]);

// --- tables -----------------------------------------------------------------

export const createTableSchema = z.object({
  branchId: cuidSchema,
  name: tableName,
  area: areaName.nullish(),
  seats: z.number().int().min(1).max(100).default(4),
  isActive: z.boolean().optional(),
});

export const updateTableSchema = z
  .object({
    name: tableName.optional(),
    area: areaName.nullish(),
    seats: z.number().int().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

/**
 * Laying out a dining room in one call: `{ prefix: "T-", from: 1, to: 20 }`.
 *
 * The range is capped at 200 per call — beyond that it is almost certainly a
 * typo (`to: 20000`), and a typo that creates twenty thousand rows is tedious
 * to undo.
 */
export const bulkTableSchema = z
  .object({
    branchId: cuidSchema,
    prefix: z.string().trim().max(20).default("T-"),
    from: z.number().int().min(0).max(100_000),
    to: z.number().int().min(0).max(100_000),
    /** Zero-pads the number, so T-01 sorts next to T-02 rather than T-10. */
    padTo: z.number().int().min(1).max(6).nullish(),
    seats: z.number().int().min(1).max(100).default(4),
    area: areaName.nullish(),
  })
  .refine((value) => value.to >= value.from, { message: "The range must not run backwards", path: ["to"] })
  .refine((value) => value.to - value.from < 200, {
    message: "Create at most 200 tables at a time",
    path: ["to"],
  });

export const tableQuerySchema = z.object({
  branchId: cuidSchema.optional(),
  area: areaName.optional(),
  isActive: z.stringbool().optional(),
  search: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const areaQuerySchema = z.object({ branchId: cuidSchema });

// --- QR codes ---------------------------------------------------------------

/**
 * A custom-URL code points off-platform (a feedback form, a social profile).
 *
 * Restricted to http(s) on purpose: the value ends up printed on a sticker and
 * opened by a phone, so allowing arbitrary schemes would let anyone with QR
 * edit rights print a code that opens `javascript:` or a deep link into another
 * app on a customer's phone.
 */
const customUrlSchema = z
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), "Use an http or https URL");

export const createQrSchema = z.object({
  branchId: cuidSchema,
  targetType: qrTargetTypeSchema.default("MENU"),
  menuId: cuidSchema.nullish(),
  tableId: cuidSchema.nullish(),
  categoryId: cuidSchema.nullish(),
  productId: cuidSchema.nullish(),
  customUrl: customUrlSchema.nullish(),
  label: z.string().trim().max(120).nullish(),
  isActive: z.boolean().optional(),
});

/** `code` is absent on purpose: it is printed on physical objects. */
export const updateQrSchema = z
  .object({
    targetType: qrTargetTypeSchema.optional(),
    menuId: cuidSchema.nullish(),
    tableId: cuidSchema.nullish(),
    categoryId: cuidSchema.nullish(),
    productId: cuidSchema.nullish(),
    customUrl: customUrlSchema.nullish(),
    label: z.string().trim().max(120).nullish(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const qrQuerySchema = z.object({
  branchId: cuidSchema.optional(),
  targetType: qrTargetTypeSchema.optional(),
  tableId: cuidSchema.optional(),
  isActive: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const qrImageQuerySchema = z.object({
  format: z.enum(["svg", "png"]).default("svg"),
  /** Pixel width for PNG; ignored for SVG beyond its viewBox. */
  size: z.coerce.number().int().min(128).max(2048).default(512),
  /** Stamps `printedAt`, so "which codes were never printed" stays answerable. */
  markPrinted: z.stringbool().default(false),
});

export const analyticsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const branchAnalyticsQuerySchema = analyticsQuerySchema.extend({ branchId: cuidSchema });

// --- public scan ------------------------------------------------------------

/**
 * The code is a Crockford-alphabet short code, so the pattern is tight: an
 * obviously malformed code is rejected before it reaches the database.
 */
export const qrCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9A-HJKMNP-TV-Z]{6,16}$/i, "Not a valid code")
    .transform((value) => value.toUpperCase()),
});

export const scanQuerySchema = z.object({
  /** Anonymous browser id, so repeat scans by one diner can be told apart. */
  sessionId: z.string().trim().min(6).max(120).optional(),
  includeUnavailable: z.stringbool().default(false),
});
