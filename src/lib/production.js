import { parseCost, parseQuantity } from "@/lib/inventory";

/**
 * Recipes and production, as the screens need them: labels, unit families and
 * the forms turned into what the API accepts.
 *
 * Pure, so the rules a form enforces before sending are unit-tested in the
 * same place as the words it shows. The server checks everything again — this
 * only saves a round trip and says the problem next to the box that has it.
 */

// --- words ------------------------------------------------------------------

/** What a recipe makes. A dish is made to order; a prep item is made in batches and stocked. */
export const RECIPE_KINDS = [
  { value: "DISH", label: "A dish on the menu", short: "Dish" },
  { value: "STOCK", label: "A prep item we keep in stock", short: "Prep" },
];

export const PRODUCTION_STATES = {
  PLANNED: { label: "Planned", tone: "bg-surface-container-high text-on-surface-variant" },
  IN_PROGRESS: { label: "In progress", tone: "bg-warning-container text-on-warning-container" },
  COMPLETED: { label: "Done", tone: "bg-success-container text-on-success-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

export const PRODUCTION_TABS = [
  { value: "PLANNED", label: "Planned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

/** Reasons a run's loss may be booked under. Customer returns and theft are not kitchen yield. */
export const YIELD_LOSS_REASONS = [
  { value: "PRODUCTION_LOSS", label: "Normal yield loss" },
  { value: "COOKING_ERROR", label: "Cooking error" },
  { value: "SPILLAGE", label: "Spilled" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "OVER_PRODUCTION", label: "Made too much" },
  { value: "SPOILED", label: "Spoiled" },
  { value: "OTHER", label: "Something else" },
];

// --- units ------------------------------------------------------------------

/** The base a unit converts through; its own id when it is a base. */
export function unitRoot(unit) {
  return unit?.baseUnitId ?? unit?.id ?? null;
}

/**
 * Units that convert to and from `unitId`: the same base, so the same family.
 *
 * Same type is not enough — two bases of one type that nobody linked have no
 * factor between them, and the server refuses them. Offering them here would
 * only make a form that fails on submit.
 */
export function unitFamily(units, unitId) {
  const anchor = units.find((unit) => unit.id === unitId);
  if (!anchor) return [];
  const root = unitRoot(anchor);
  return units.filter((unit) => unitRoot(unit) === root);
}

// --- recipe form ------------------------------------------------------------

let nextKey = 0;

export function blankIngredient(overrides = {}) {
  nextKey += 1;
  return {
    key: `ingredient-${nextKey}`,
    source: "ITEM",
    itemId: "",
    subRecipeId: "",
    quantity: "",
    uomId: "",
    wastagePercent: "",
    isOptional: false,
    note: "",
    ...overrides,
  };
}

const text = (value) => (value === null || value === undefined ? "" : String(value));

/** A decimal as a form shows it: no trailing zeros, no exponent. */
export function decimalText(value) {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value);
  if (!raw.includes(".")) return raw;
  return raw.replace(/\.?0+$/, "");
}

/** The form's starting values, blank or from a saved recipe. */
export function recipeFormValues(recipe = null, { kind = "DISH" } = {}) {
  if (!recipe) {
    return {
      kind,
      variantId: "",
      outputItemId: "",
      name: "",
      yieldQuantity: "1",
      yieldUomId: "",
      prepTimeMinutes: "",
      cookTimeMinutes: "",
      instructions: "",
      laborCost: "",
      overheadCost: "",
      lines: [blankIngredient()],
    };
  }

  return {
    kind: recipe.variantId ? "DISH" : "STOCK",
    variantId: recipe.variantId ?? "",
    outputItemId: recipe.outputItemId ?? "",
    name: recipe.name ?? "",
    yieldQuantity: decimalText(recipe.yieldQuantity) || "1",
    yieldUomId: recipe.yieldUomId ?? "",
    prepTimeMinutes: text(recipe.prepTimeMinutes),
    cookTimeMinutes: text(recipe.cookTimeMinutes),
    instructions: recipe.instructions ?? "",
    laborCost: decimalText(recipe.laborCost),
    overheadCost: decimalText(recipe.overheadCost),
    lines: (recipe.ingredients ?? []).map((line) =>
      blankIngredient({
        source: line.subRecipeId ? "RECIPE" : "ITEM",
        itemId: line.itemId ?? "",
        subRecipeId: line.subRecipeId ?? "",
        quantity: decimalText(line.quantity),
        uomId: line.uomId ?? "",
        wastagePercent: Number(line.wastagePercent) ? decimalText(line.wastagePercent) : "",
        isOptional: Boolean(line.isOptional),
        note: line.note ?? "",
      }),
    ),
  };
}

function parseMinutes(input) {
  const value = String(input ?? "").trim();
  if (!value) return { value: null };
  if (!/^\d+$/.test(value)) return { error: "Whole minutes, e.g. 20." };
  const minutes = Number(value);
  if (minutes > 10_000) return { error: "That is more than a week." };
  return { value: minutes };
}

/**
 * A recipe form, as the API wants it.
 *
 * `units`, `items` and `recipes` are the pickers' own lists, used to check
 * that each line's unit belongs to the family its ingredient is measured in.
 * `includeCost` sends labour and overhead; without it they are left out, so a
 * chef who cannot see costs never overwrites them with blanks.
 *
 * On `edit`, the output is fixed and is not sent.
 */
export function recipePayload(form, { mode = "create", includeCost = false, units = [], items = [], recipes = [], outputItem = null, selfId = null } = {}) {
  const errors = {};
  const lineErrors = {};
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  const name = String(form.name ?? "").trim();
  if (!name) errors.name = "Give the recipe a name.";
  else if (name.length > 160) errors.name = "Keep it under 160 characters.";

  if (mode === "create") {
    if (form.kind === "DISH" && !form.variantId) errors.variantId = "Choose the dish this recipe makes.";
    if (form.kind === "STOCK" && !form.outputItemId) errors.outputItemId = "Choose the item this recipe makes.";
  }

  const yieldQuantity = parseQuantity(form.yieldQuantity);
  if (yieldQuantity.error) errors.yieldQuantity = yieldQuantity.error;
  if (!form.yieldUomId) errors.yieldUomId = "Choose the unit it is made in.";
  else if (form.kind === "STOCK" && outputItem && unitRoot(unitById.get(form.yieldUomId)) !== unitRoot(unitById.get(outputItem.uomId))) {
    errors.yieldUomId = `${outputItem.name} is stocked in ${unitById.get(outputItem.uomId)?.code ?? "another unit"} — choose a unit that converts to it.`;
  }

  const prep = parseMinutes(form.prepTimeMinutes);
  if (prep.error) errors.prepTimeMinutes = prep.error;
  const cook = parseMinutes(form.cookTimeMinutes);
  if (cook.error) errors.cookTimeMinutes = cook.error;

  const instructions = String(form.instructions ?? "").trim();
  if (instructions.length > 8000) errors.instructions = "Keep it under 8,000 characters.";

  const labor = includeCost ? parseCost(form.laborCost) : { value: undefined };
  if (labor.error) errors.laborCost = labor.error;
  const overhead = includeCost ? parseCost(form.overheadCost) : { value: undefined };
  if (overhead.error) errors.overheadCost = overhead.error;

  const seen = new Set();
  const ingredients = [];
  (form.lines ?? []).forEach((line, index) => {
    const problems = {};
    const fromRecipe = line.source === "RECIPE";
    const id = fromRecipe ? line.subRecipeId : line.itemId;

    if (!id) problems.ingredient = fromRecipe ? "Choose a recipe." : "Choose an item.";
    else if (fromRecipe && selfId && id === selfId) problems.ingredient = "A recipe cannot include itself.";
    else if (seen.has(id)) problems.ingredient = "This is already on another line — combine them.";
    if (id) seen.add(id);

    const quantity = parseQuantity(line.quantity);
    if (quantity.error) problems.quantity = quantity.error;

    const measuredIn = fromRecipe ? recipeById.get(id)?.yieldUomId : itemById.get(id)?.uomId;
    if (!line.uomId) problems.uomId = "Choose a unit.";
    else if (measuredIn && unitRoot(unitById.get(line.uomId)) !== unitRoot(unitById.get(measuredIn))) {
      problems.uomId = `Use a unit that converts to ${unitById.get(measuredIn)?.code ?? "its own unit"}.`;
    }

    const wastage = String(line.wastagePercent ?? "").trim();
    let wastagePercent;
    if (wastage) {
      const parsed = parseQuantity(wastage, { allowZero: true, max: 100 });
      if (parsed.error) problems.wastagePercent = parsed.error === "That number is too large." ? "At most 100%." : parsed.error;
      else wastagePercent = parsed.value;
    }

    const note = String(line.note ?? "").trim();
    if (note.length > 500) problems.note = "Keep it under 500 characters.";

    if (Object.keys(problems).length) {
      lineErrors[index] = problems;
      return;
    }

    ingredients.push({
      ...(fromRecipe ? { subRecipeId: id } : { itemId: id }),
      quantity: quantity.value,
      uomId: line.uomId,
      ...(wastagePercent !== undefined ? { wastagePercent } : {}),
      isOptional: Boolean(line.isOptional),
      sortOrder: ingredients.length,
      note: note || null,
    });
  });

  if (!form.lines?.length) errors.lines = "Add at least one ingredient.";
  else if (Object.keys(lineErrors).length) errors.lines = "Some ingredients need attention.";

  const body = {
    name,
    yieldQuantity: yieldQuantity.value,
    yieldUomId: form.yieldUomId,
    prepTimeMinutes: prep.value ?? null,
    cookTimeMinutes: cook.value ?? null,
    instructions: instructions || null,
    ...(includeCost && labor.value !== undefined ? { laborCost: labor.value } : {}),
    ...(includeCost && overhead.value !== undefined ? { overheadCost: overhead.value } : {}),
    // Blank labour on an edit means none, not "leave it as it was".
    ...(includeCost && mode !== "create" && labor.value === undefined ? { laborCost: 0 } : {}),
    ...(includeCost && mode !== "create" && overhead.value === undefined ? { overheadCost: 0 } : {}),
    ingredients,
  };

  if (mode === "create") {
    Object.assign(body, form.kind === "DISH" ? { variantId: form.variantId } : { outputItemId: form.outputItemId });
    // A prep item is made in batches and stocked; a dish is made to order.
    body.isBatchProduced = form.kind === "STOCK";
  }

  return { body, errors, lineErrors };
}

/** Whether saving a recipe edits it in place or makes the next version. */
export function recipeSaveMode(recipe) {
  if (!recipe) return "create";
  return recipe.usage?.isUsed ? "revise" : "edit";
}

// --- production forms -------------------------------------------------------

/** Today in the viewer's own calendar, as a date input writes it. */
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function productionPlanPayload(form) {
  const errors = {};
  if (!form.recipeId) errors.recipeId = "Choose what to make.";
  if (!form.locationId) errors.locationId = "Choose where it is made.";
  const planned = parseQuantity(form.plannedQuantity);
  if (planned.error) errors.plannedQuantity = planned.error;

  const scheduled = String(form.scheduledFor ?? "").trim();
  if (scheduled && !/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) errors.scheduledFor = "Enter a date.";

  const batchNumber = String(form.batchNumber ?? "").trim();
  if (batchNumber.length > 60) errors.batchNumber = "Keep it under 60 characters.";
  const notes = String(form.notes ?? "").trim();
  if (notes.length > 2000) errors.notes = "Keep it under 2,000 characters.";

  return {
    body: {
      recipeId: form.recipeId,
      locationId: form.locationId,
      plannedQuantity: planned.value,
      ...(scheduled ? { scheduledFor: scheduled } : {}),
      ...(batchNumber ? { batchNumber } : {}),
      ...(notes ? { notes } : {}),
    },
    errors,
  };
}

/**
 * What to issue when a run starts.
 *
 * Every line left at the plan sends nothing at all — the server then issues
 * exactly what the recipe calls for. Only when something differs is the whole
 * list sent, and a line set to zero is left off it.
 */
export function startRunPayload(materials, entered) {
  const errors = {};
  const items = [];
  let changed = false;

  for (const line of materials) {
    const typed = entered[line.itemId];
    const parsed = parseQuantity(typed, { allowZero: true });
    if (parsed.error) {
      errors[line.itemId] = parsed.error;
      continue;
    }
    if (Math.abs(parsed.value - Number(line.plannedQuantity)) > 1e-9) changed = true;
    if (parsed.value > 0) items.push({ itemId: line.itemId, quantity: parsed.value });
  }

  if (!Object.keys(errors).length && changed && !items.length) {
    errors.form = "Nothing would be issued. Cancel the run instead.";
  }

  return { body: changed ? { items } : {}, errors };
}

export function issuePayload(lines) {
  const lineErrors = {};
  const items = [];
  const seen = new Set();
  lines.forEach((line, index) => {
    const problems = {};
    if (!line.itemId) problems.itemId = "Choose an item.";
    else if (seen.has(line.itemId)) problems.itemId = "Already on another line.";
    if (line.itemId) seen.add(line.itemId);
    const quantity = parseQuantity(line.quantity);
    if (quantity.error) problems.quantity = quantity.error;
    if (Object.keys(problems).length) lineErrors[index] = problems;
    else items.push({ itemId: line.itemId, quantity: quantity.value });
  });
  return { body: { items }, lineErrors, error: !lines.length ? "Add an item." : Object.keys(lineErrors).length ? "Some lines need attention." : null };
}

export function completeRunPayload(form, { includeCost = false, tracked = false, today = null } = {}) {
  const errors = {};
  const produced = parseQuantity(form.producedQuantity);
  if (produced.error) errors.producedQuantity = produced.error === "Enter more than zero." ? "Enter what came out. Cancel the run if it made nothing." : produced.error;

  const wastedText = String(form.wastedQuantity ?? "").trim();
  const wasted = wastedText ? parseQuantity(wastedText, { allowZero: true }) : { value: 0 };
  if (wasted.error) errors.wastedQuantity = wasted.error;

  const wastageNotes = String(form.wastageNotes ?? "").trim();
  if (wasted.value > 0 && form.wastageReason === "OTHER" && !wastageNotes) errors.wastageNotes = "Say what happened.";
  if (wastageNotes.length > 1000) errors.wastageNotes = "Keep it under 1,000 characters.";

  const labor = includeCost ? parseCost(form.laborCost) : { value: undefined };
  if (labor.error) errors.laborCost = labor.error;
  const overhead = includeCost ? parseCost(form.overheadCost) : { value: undefined };
  if (overhead.error) errors.overheadCost = overhead.error;

  const batchNumber = tracked ? String(form.batchNumber ?? "").trim() : "";
  if (batchNumber.length > 60) errors.batchNumber = "Keep it under 60 characters.";
  const expiry = tracked ? String(form.expiryDate ?? "").trim() : "";
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) errors.expiryDate = "Enter a date.";
  else if (expiry && today && expiry < today) errors.expiryDate = "That date has already passed.";

  const notes = String(form.notes ?? "").trim();
  if (notes.length > 2000) errors.notes = "Keep it under 2,000 characters.";

  return {
    body: {
      producedQuantity: produced.value,
      ...(wasted.value > 0
        ? { wastedQuantity: wasted.value, wastageReason: form.wastageReason || "PRODUCTION_LOSS", ...(wastageNotes ? { wastageNotes } : {}) }
        : {}),
      ...(labor.value !== undefined ? { laborCost: labor.value } : {}),
      ...(overhead.value !== undefined ? { overheadCost: overhead.value } : {}),
      ...(batchNumber ? { batchNumber } : {}),
      ...(expiry ? { expiryDate: expiry } : {}),
      ...(notes ? { notes } : {}),
    },
    errors,
  };
}

/** Good output as a share of everything made, for the result panel. Null before anything was made. */
export function yieldPercent(produced, wasted) {
  const good = Number(produced ?? 0);
  const total = good + Number(wasted ?? 0);
  if (!(total > 0)) return null;
  return Math.round((good / total) * 1000) / 10;
}
