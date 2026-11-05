import { z } from "zod";
import { fitsScale } from "@/lib/money-math";
import { cuidSchema } from "@/server/validation/schemas";
import { patchSchema } from "@/server/validation/patch";

/**
 * Catalog request schemas — categories, products, variants, modifiers, combos,
 * menus and kitchen stations.
 *
 * Kept in their own module rather than appended to `schemas.js`: the catalog is
 * the largest surface in the API and mixing it into the identity schemas makes
 * both harder to read. Routes import from whichever module owns their shape.
 */

/**
 * Money crosses the API as a plain number and is stored as Decimal(18,4).
 * Four decimal places is the column's precision, so anything longer would be
 * silently rounded by Postgres — reject it here instead, where the client can
 * still be told which field was wrong.
 */
export const moneySchema = z
  .number()
  .finite()
  .min(0, "Price cannot be negative")
  .max(99_999_999, "Price is out of range")
  .refine((value) => fitsScale(value, 4), "Price supports at most 4 decimal places");

/** A price delta may be negative: "no cheese, -50". */
export const deltaSchema = z
  .number()
  .finite()
  .min(-99_999_999)
  .max(99_999_999)
  .refine((value) => fitsScale(value, 4), "Price supports at most 4 decimal places");

const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(2000);
// No `.default()`: every use is `.optional()`, and in Zod 4 a default survives
// that — an omitted position would arrive as 0 and defeat each service's
// "append at the end" fallback, stacking new rows on top of each other.
const sortOrder = z.number().int().min(0).max(100_000);

export const dietaryTagSchema = z.enum(["VEG", "NON_VEG", "VEGAN", "EGG", "HALAL", "JAIN", "GLUTEN_FREE"]);
export const productTypeSchema = z.enum(["SIMPLE", "VARIANT", "COMBO"]);
export const menuTypeSchema = z.enum(["DINE_IN", "DELIVERY", "TAKEAWAY", "QR", "POS", "CATERING"]);
export const selectionTypeSchema = z.enum(["SINGLE", "MULTIPLE"]);

/** Minutes from midnight; past 1440 expresses a window running into tomorrow. */
const minuteOfDay = z.number().int().min(0).max(2879);

// --- categories -------------------------------------------------------------

export const createCategorySchema = z.object({
  name: shortText,
  slug: z.string().trim().min(1).max(140).optional(),
  // Nullable so an edit can clear them: `optional()` alone accepts neither
  // `null` nor `""`, which left a description or image impossible to remove.
  description: longText.nullish(),
  imageUrl: z.url().max(2000).nullish(),
  parentId: cuidSchema.nullish(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = patchSchema(createCategorySchema);

export const categoryQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  isActive: z.stringbool().optional(),
  parentId: cuidSchema.optional(),
  /** Nested children instead of a flat list. */
  tree: z.stringbool().default(false),
  includeCounts: z.stringbool().default(false),
});

export const reorderSchema = z.object({
  items: z.array(z.object({ id: cuidSchema, sortOrder: z.number().int().min(0).max(100_000) })).min(1).max(500),
});

// --- kitchen stations -------------------------------------------------------

export const createStationSchema = z.object({
  name: shortText,
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, hyphens and underscores only")
    .transform((value) => value.toUpperCase()),
  // Nullable so an edit can unassign the printer.
  printerId: z.string().trim().max(120).nullish(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export const updateStationSchema = patchSchema(createStationSchema);

// --- variants ---------------------------------------------------------------

export const variantInputSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Regular"),
  sku: z.string().trim().min(1).max(60).optional(),
  // Nullable so an edit can clear them — a "was" price left behind after a
  // promotion ends keeps showing a discount that no longer exists.
  barcode: z.string().trim().min(1).max(60).nullish(),
  price: moneySchema,
  compareAtPrice: moneySchema.nullish(),
  servingSize: z.string().trim().max(60).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});

export const updateVariantSchema = patchSchema(variantInputSchema);

// --- products ---------------------------------------------------------------

export const productImageSchema = z.object({
  url: z.url().max(2000),
  altText: z.string().trim().max(200).optional(),
  sortOrder: sortOrder.optional(),
});

export const createProductSchema = z
  .object({
    name: shortText,
    slug: z.string().trim().min(1).max(160).optional(),
    description: longText.nullish(),
    shortDescription: z.string().trim().max(300).nullish(),
    type: productTypeSchema.default("SIMPLE"),
    categoryId: cuidSchema,
    /**
     * Which outlet sells this. Omit it, or send null, and the item is on the
     * whole chain's catalogue — which is why writing one takes a company-wide
     * grant. A single-branch restaurant never sends this at all.
     */
    branchId: cuidSchema.nullish(),
    imageUrl: z.url().max(2000).nullish(),
    images: z.array(productImageSchema).max(12).optional(),
    dietary: z.array(dietaryTagSchema).max(7).optional(),
    spiceLevel: z.number().int().min(0).max(5).nullish(),
    allergens: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    calories: z.number().int().min(0).max(20_000).nullish(),
    prepTimeMinutes: z.number().int().min(0).max(1440).optional(),
    taxGroupId: cuidSchema.nullish(),
    stationId: cuidSchema.nullish(),
    isFeatured: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
    /**
     * A SIMPLE product may be created with just a price; the service turns it
     * into the single default variant. A VARIANT product must list its own.
     */
    price: moneySchema.optional(),
    variants: z.array(variantInputSchema).max(50).optional(),
  })
  .refine((value) => value.price !== undefined || (value.variants?.length ?? 0) > 0 || value.type === "COMBO", {
    message: "Provide a price, or at least one variant",
    path: ["price"],
  });

export const updateProductSchema = patchSchema(
  z.object({
    name: shortText.optional(),
    slug: z.string().trim().min(1).max(160).optional(),
    description: longText.nullish(),
    shortDescription: z.string().trim().max(300).nullish(),
    categoryId: cuidSchema.optional(),
    /** Moving a product between outlets, or onto the chain's catalogue. */
    branchId: cuidSchema.nullish(),
    imageUrl: z.url().max(2000).nullish(),
    dietary: z.array(dietaryTagSchema).max(7).optional(),
    spiceLevel: z.number().int().min(0).max(5).nullish(),
    allergens: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    calories: z.number().int().min(0).max(20_000).nullish(),
    prepTimeMinutes: z.number().int().min(0).max(1440).optional(),
    taxGroupId: cuidSchema.nullish(),
    stationId: cuidSchema.nullish(),
    isFeatured: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
  }),
);

/** Publishing is its own permission, so it is its own endpoint and schema. */
export const publishProductSchema = z.object({ isActive: z.boolean() });

export const setImagesSchema = z.object({ images: z.array(productImageSchema).max(12) });

export const adminProductQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  categoryId: cuidSchema.optional(),
  /** Narrows to one outlet. The caller's own scope still applies on top. */
  branchId: cuidSchema.optional(),
  stationId: cuidSchema.optional(),
  type: productTypeSchema.optional(),
  isActive: z.stringbool().optional(),
  isFeatured: z.stringbool().optional(),
  includeDeleted: z.stringbool().default(false),
  /** Only the deleted ones — the "bin" a restore screen lists. */
  onlyDeleted: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

// --- modifiers --------------------------------------------------------------

export const modifierOptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priceDelta: deltaSchema.default(0),
  sku: z.string().trim().max(60).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});

export const updateModifierOptionSchema = patchSchema(modifierOptionSchema);

export const createModifierGroupSchema = z.object({
  name: shortText,
  internalName: z.string().trim().min(1).max(120).optional(),
  selectionType: selectionTypeSchema.default("SINGLE"),
  minSelect: z.number().int().min(0).max(50).default(0),
  maxSelect: z.number().int().min(1).max(50).default(1),
  allowQuantity: z.boolean().default(false),
  isActive: z.boolean().optional(),
  options: z.array(modifierOptionSchema).max(100).optional(),
});

export const updateModifierGroupSchema = patchSchema(createModifierGroupSchema.omit({ options: true }));

/** Attaching a group to a product, with optional per-product rule overrides. */
export const attachModifierGroupSchema = z.object({
  groupId: cuidSchema,
  isRequired: z.boolean().default(false),
  minSelect: z.number().int().min(0).max(50).nullish(),
  maxSelect: z.number().int().min(1).max(50).nullish(),
  sortOrder: sortOrder.optional(),
});

export const updateAttachedGroupSchema = patchSchema(attachModifierGroupSchema.omit({ groupId: true }));

// --- combos -----------------------------------------------------------------

export const comboOptionSchema = z.object({
  productId: cuidSchema,
  variantId: cuidSchema.nullish(),
  quantity: z.number().int().min(1).max(20).default(1),
  priceDelta: deltaSchema.default(0),
  isDefault: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});

export const createComboGroupSchema = z.object({
  name: shortText,
  minSelect: z.number().int().min(0).max(20).default(1),
  maxSelect: z.number().int().min(1).max(20).default(1),
  sortOrder: sortOrder.optional(),
  options: z.array(comboOptionSchema).max(100).optional(),
});

export const updateComboGroupSchema = patchSchema(createComboGroupSchema.omit({ options: true }));

export const updateComboOptionSchema = patchSchema(comboOptionSchema.omit({ productId: true }));

// --- menus ------------------------------------------------------------------

export const createMenuSchema = z
  .object({
    branchId: cuidSchema,
    name: shortText,
    slug: z.string().trim().min(1).max(140).optional(),
    type: menuTypeSchema.default("DINE_IN"),
    description: longText.nullish(),
    activeFrom: z.coerce.date().nullish(),
    activeTo: z.coerce.date().nullish(),
    startMinute: minuteOfDay.nullish(),
    endMinute: minuteOfDay.nullish(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => !(value.activeFrom && value.activeTo) || value.activeTo > value.activeFrom, {
    message: "The menu must finish after it starts",
    path: ["activeTo"],
  })
  .refine((value) => (value.startMinute == null) === (value.endMinute == null), {
    message: "Provide both startMinute and endMinute, or neither",
    path: ["endMinute"],
  })
  .refine((value) => value.startMinute == null || value.endMinute > value.startMinute, {
    message: "Use minutes past 1440 for a window that runs past midnight",
    path: ["endMinute"],
  });

export const updateMenuSchema = z
  .object({
    name: shortText.optional(),
    slug: z.string().trim().min(1).max(140).optional(),
    type: menuTypeSchema.optional(),
    description: longText.nullish(),
    activeFrom: z.coerce.date().nullish(),
    activeTo: z.coerce.date().nullish(),
    startMinute: minuteOfDay.nullish(),
    endMinute: minuteOfDay.nullish(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

const catalogResourceSchema = z.enum(["categories", "products", "variants", "menu-items"]);

export const catalogExportQuerySchema = z.object({
  resource: catalogResourceSchema,
  /// Both only narrow a menu-items export; ignored for the other resources.
  branchId: cuidSchema.optional(),
  menuId: cuidSchema.optional(),
});

/**
 * A catalog import.
 *
 * The CSV arrives as a JSON string rather than a multipart upload: it keeps the
 * endpoint identical for the website and the mobile app, and the file is text
 * measured in hundreds of kilobytes, not a video.
 */
export const catalogImportSchema = z.object({
  resource: catalogResourceSchema,
  csv: z.string().min(1, "The file is empty").max(4 * 1024 * 1024),
  /// Validate and report without writing anything.
  dryRun: z.boolean().default(false),
});

/**
 * Cloning a menu. Every field is optional: with an empty body the menu is
 * copied onto its own branch and channel as "<name> (copy)", inactive.
 */
export const cloneMenuSchema = z.object({
  branchId: cuidSchema.optional(),
  type: menuTypeSchema.optional(),
  name: shortText.optional(),
  slug: z.string().trim().min(1).max(140).optional(),
  isActive: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  includeItems: z.boolean().default(true),
});

export const menuQuerySchema = z.object({
  branchId: cuidSchema.optional(),
  type: menuTypeSchema.optional(),
  isActive: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const createSectionSchema = z.object({
  name: shortText,
  description: longText.nullish(),
  imageUrl: z.url().max(2000).nullish(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export const updateSectionSchema = patchSchema(createSectionSchema);

/**
 * Adding a product to a menu.
 *
 * With no `variantId` every active variant of the product is added, each as its
 * own row — that is what makes per-size pricing and per-size sold-out possible.
 */
export const addMenuItemSchema = z.object({
  productId: cuidSchema,
  variantId: cuidSchema.optional(),
  sectionId: cuidSchema.nullish(),
  priceOverride: moneySchema.nullish(),
  isRecommended: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});

export const updateMenuItemSchema = patchSchema(
  z.object({
    sectionId: cuidSchema.nullish(),
    priceOverride: moneySchema.nullish(),
    isRecommended: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
  }),
);

/** Several products at once, every active size of each. */
export const addMenuProductsSchema = z.object({
  productIds: z.array(cuidSchema).min(1, "Pick at least one product").max(200, "Add at most 200 products at a time"),
  sectionId: cuidSchema.nullish(),
});

/** The menu's complete product order, first to last. */
export const reorderMenuProductsSchema = z.object({
  productIds: z.array(cuidSchema).min(1).max(5000),
});

export const updateMenuProductSchema = patchSchema(
  z.object({
    sectionId: cuidSchema.nullish(),
    isRecommended: z.boolean().optional(),
  }),
);

/**
 * The 86 switch. `until` is optional: omitted means "until someone turns it
 * back on", which is what a permanently sold-out seasonal item needs.
 */
export const availabilitySchema = z.object({
  isAvailable: z.boolean(),
  until: z.coerce.date().nullish(),
});

export const menuItemQuerySchema = z.object({
  sectionId: cuidSchema.optional(),
  isAvailable: z.stringbool().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

// --- public catalog ---------------------------------------------------------

export const publicProductQuerySchema = z.object({
  category: z.string().trim().min(1).max(140).optional(),
  /** The outlet the shopper is browsing, when they have chosen one. */
  branchId: cuidSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  dietary: dietaryTagSchema.optional(),
  featured: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export const publicMenuQuerySchema = z.object({
  type: menuTypeSchema.optional(),
  /**
   * How the customer is ordering. Resolves the menu exactly as the cart prices
   * it — delivery and pickup fall back to dine-in — which is what a client
   * showing prices before checkout should ask for. Ignored with `type` or `menu`.
   */
  orderType: z.enum(["DELIVERY", "PICKUP", "DINE_IN"]).optional(),
  /** Pick a specific menu instead of letting the branch's schedule decide. */
  menu: z.string().trim().min(1).max(140).optional(),
  /** Preview a menu as it will look at another time — "what shows at 9pm?". */
  at: z.coerce.date().optional(),
  includeUnavailable: z.stringbool().default(false),
});

// --- route params -----------------------------------------------------------

export const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(200) });
export const variantParamSchema = z.object({ id: cuidSchema, variantId: cuidSchema });
export const optionParamSchema = z.object({ id: cuidSchema, optionId: cuidSchema });
export const groupParamSchema = z.object({ id: cuidSchema, groupId: cuidSchema });
export const sectionParamSchema = z.object({ id: cuidSchema, sectionId: cuidSchema });
export const itemParamSchema = z.object({ id: cuidSchema, itemId: cuidSchema });
export const menuProductParamSchema = z.object({ id: cuidSchema, productId: cuidSchema });
