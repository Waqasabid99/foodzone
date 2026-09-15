import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";
import { costSchema, positiveQuantitySchema, quantitySchema } from "@/server/validation/inventory.schemas";

/**
 * Recipe and production request schemas.
 *
 * The same rule the inventory module runs on applies here: **a request never
 * states a cost.** A recipe says what goes into a dish; what that costs is
 * rolled up from the item master. A production run says what came out; what it
 * cost is derived from what was actually consumed. Labour and overhead are the
 * only money a client may name, because they are inputs nobody can derive.
 */

const shortText = z.string().trim().min(1).max(160);
const longText = z.string().trim().max(8000);

// --- recipes ----------------------------------------------------------------

export const recipeIngredientSchema = z
  .object({
    itemId: cuidSchema.nullish(),
    subRecipeId: cuidSchema.nullish(),
    quantity: positiveQuantitySchema,
    uomId: cuidSchema.nullish(),
    /** Loss specific to this recipe, on top of the item's own prep yield. */
    wastagePercent: z.number().finite().min(0).max(100).optional(),
    isOptional: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine(
    (line) => Boolean(line.itemId) !== Boolean(line.subRecipeId),
    "Give exactly one of itemId or subRecipeId",
  );

export const createRecipeSchema = z
  .object({
    name: shortText,
    variantId: cuidSchema.nullish(),
    outputItemId: cuidSchema.nullish(),
    yieldQuantity: positiveQuantitySchema.optional(),
    yieldUomId: cuidSchema,
    isActive: z.boolean().optional(),
    isBatchProduced: z.boolean().optional(),
    prepTimeMinutes: z.number().int().min(0).max(10_000).nullish(),
    cookTimeMinutes: z.number().int().min(0).max(10_000).nullish(),
    instructions: longText.nullish(),
    laborCost: costSchema.optional(),
    overheadCost: costSchema.optional(),
    ingredients: z.array(recipeIngredientSchema).min(1).max(200),
  })
  .refine(
    (recipe) => Boolean(recipe.variantId) !== Boolean(recipe.outputItemId),
    "A recipe makes exactly one thing: give either variantId or outputItemId",
  );

export const updateRecipeSchema = z
  .object({
    name: shortText.optional(),
    yieldQuantity: positiveQuantitySchema.optional(),
    yieldUomId: cuidSchema.optional(),
    isActive: z.boolean().optional(),
    isBatchProduced: z.boolean().optional(),
    prepTimeMinutes: z.number().int().min(0).max(10_000).nullish(),
    cookTimeMinutes: z.number().int().min(0).max(10_000).nullish(),
    instructions: longText.nullish(),
    laborCost: costSchema.optional(),
    overheadCost: costSchema.optional(),
    ingredients: z.array(recipeIngredientSchema).min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

/** A revision carries everything forward, so every field is optional. */
export const reviseRecipeSchema = z.object({
  name: shortText.optional(),
  yieldQuantity: positiveQuantitySchema.optional(),
  yieldUomId: cuidSchema.optional(),
  isBatchProduced: z.boolean().optional(),
  prepTimeMinutes: z.number().int().min(0).max(10_000).nullish(),
  cookTimeMinutes: z.number().int().min(0).max(10_000).nullish(),
  instructions: longText.nullish(),
  laborCost: costSchema.optional(),
  overheadCost: costSchema.optional(),
  ingredients: z.array(recipeIngredientSchema).min(1).max(200).optional(),
});

export const listRecipesSchema = z.object({
  search: z.string().trim().max(120).optional(),
  variantId: cuidSchema.optional(),
  outputItemId: cuidSchema.optional(),
  isActive: z.stringbool().optional(),
  isBatchProduced: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const recipeVersionsSchema = z
  .object({
    variantId: cuidSchema.optional(),
    outputItemId: cuidSchema.optional(),
  })
  .refine((value) => Boolean(value.variantId) !== Boolean(value.outputItemId), "Give one of variantId or outputItemId");

export const menuCostReportSchema = z.object({
  branchId: cuidSchema.optional(),
  categoryId: cuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const recostAllSchema = z.object({
  onlyActive: z.boolean().optional(),
});

// --- modifier ingredients ---------------------------------------------------

export const modifierIngredientSchema = z.object({
  itemId: cuidSchema,
  quantity: positiveQuantitySchema,
  uomId: cuidSchema.nullish(),
});

export const modifierCostReportSchema = z.object({
  groupId: cuidSchema.optional(),
});

// --- production orders ------------------------------------------------------

export const createProductionOrderSchema = z.object({
  locationId: cuidSchema,
  recipeId: cuidSchema,
  plannedQuantity: positiveQuantitySchema,
  scheduledFor: z.coerce.date().nullish(),
  supervisorId: cuidSchema.nullish(),
  batchNumber: z.string().trim().max(60).nullish(),
  expiryDate: z.coerce.date().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const updateProductionOrderSchema = z
  .object({
    plannedQuantity: positiveQuantitySchema.optional(),
    scheduledFor: z.coerce.date().nullish(),
    supervisorId: cuidSchema.nullish(),
    batchNumber: z.string().trim().max(60).nullish(),
    expiryDate: z.coerce.date().nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const consumptionLineSchema = z.object({
  itemId: cuidSchema,
  quantity: positiveQuantitySchema,
});

/** Omitting `items` issues exactly what the recipe calls for. */
export const startProductionSchema = z.object({
  items: z.array(consumptionLineSchema).min(1).max(200).optional(),
});

export const recordConsumptionSchema = z.object({
  items: z.array(consumptionLineSchema).min(1).max(200),
});

export const completeProductionSchema = z.object({
  producedQuantity: positiveQuantitySchema,
  /** Yield loss: made, but not usable. Booked in and written off. */
  wastedQuantity: quantitySchema.min(0).optional(),
  wastageReason: z
    .enum([
      "EXPIRED",
      "SPOILED",
      "DAMAGED",
      "OVER_PRODUCTION",
      "PRODUCTION_LOSS",
      "COOKING_ERROR",
      "SPILLAGE",
      "OTHER",
    ])
    .optional(),
  wastageNotes: z.string().trim().max(1000).nullish(),
  laborCost: costSchema.optional(),
  overheadCost: costSchema.optional(),
  byProducts: z
    .array(
      z.object({
        itemId: cuidSchema,
        quantity: positiveQuantitySchema,
        /** Defaults to the by-product item's own average cost. */
        unitCost: costSchema.optional(),
      }),
    )
    .max(20)
    .optional(),
  batchNumber: z.string().trim().max(60).nullish(),
  expiryDate: z.coerce.date().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const cancelProductionSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});

export const listProductionOrdersSchema = z.object({
  branchId: cuidSchema.optional(),
  locationId: cuidSchema.optional(),
  recipeId: cuidSchema.optional(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const productionVarianceSchema = z.object({
  branchId: cuidSchema.optional(),
  recipeId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
