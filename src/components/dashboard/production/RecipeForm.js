"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { RECIPE_KINDS, blankIngredient, recipeFormValues, recipePayload, unitFamily } from "@/lib/production";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

const control = (invalid) =>
  `w-full rounded-field bg-surface-container-lowest px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${invalid ? "border border-error" : "border border-outline"}`;

/** The first plain message in an API error's details, to say which box is wrong. */
function detailOf(failure) {
  const details = failure?.details;
  if (!details || typeof details !== "object") return null;
  for (const value of Object.values(details)) {
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return null;
}

const unitOptions = (units) => units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }));

/**
 * Writes a recipe: what it makes, how much, and from what.
 *
 * Three modes. `create` starts one. `edit` changes a version nothing has been
 * made from yet, in place. `revise` is an edit to a version the kitchen has
 * already produced against — that version is the record of those runs, so the
 * change is saved as the next version instead and the old one stays as it was.
 *
 * Every unit box offers only the units that convert to what the ingredient is
 * measured in; the server refuses the rest, so offering them would only make
 * a form that fails on submit.
 */
export default function RecipeForm({
  mode = "create",
  recipe = null,
  units,
  items,
  recipes,
  variants = [],
  liveByOutput = {},
  includeCost = false,
  defaultKind = "DISH",
  defaultOutputId = "",
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => {
    const values = recipeFormValues(recipe, { kind: defaultKind });
    if (!recipe && defaultOutputId) {
      if (defaultKind === "STOCK") {
        const item = items.find((row) => row.id === defaultOutputId);
        if (item) Object.assign(values, { outputItemId: item.id, name: item.name, yieldUomId: item.uomId });
      } else {
        const variant = variants.find((row) => row.id === defaultOutputId);
        if (variant) Object.assign(values, { variantId: variant.id, name: dishName(variant) });
      }
    }
    return values;
  });
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const recipeById = useMemo(() => new Map(recipes.map((row) => [row.id, row])), [recipes]);
  const makeable = useMemo(() => items.filter((item) => item.type !== "RAW_MATERIAL"), [items]);
  // Another version of this same recipe is not a sub-recipe of it.
  const subRecipes = useMemo(
    () =>
      recipes.filter((row) => {
        if (recipe && row.id === recipe.id) return false;
        if (form.variantId && row.variantId === form.variantId) return false;
        if (form.outputItemId && row.outputItemId === form.outputItemId) return false;
        return true;
      }),
    [recipes, recipe, form.variantId, form.outputItemId],
  );

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setLine = (key, patch) => setForm((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));

  const outputItem = form.kind === "STOCK" ? itemById.get(form.outputItemId) ?? null : null;
  const yieldUnits = outputItem ? unitFamily(units, outputItem.uomId) : units;
  const existing = mode === "create" ? liveByOutput[form.kind === "DISH" ? `variant:${form.variantId}` : `item:${form.outputItemId}`] : null;

  function chooseOutput(kind, id) {
    if (kind === "DISH") {
      const variant = variants.find((row) => row.id === id);
      const previous = variants.find((row) => row.id === form.variantId);
      set({ variantId: id, ...(variant && (!form.name || form.name === dishName(previous)) ? { name: dishName(variant) } : {}) });
    } else {
      const item = itemById.get(id);
      const previous = itemById.get(form.outputItemId);
      set({
        outputItemId: id,
        ...(item && (!form.name || form.name === previous?.name) ? { name: item.name } : {}),
        // The stocking unit is the natural one to make it in.
        ...(item && (!form.yieldUomId || !unitFamily(units, item.uomId).some((unit) => unit.id === form.yieldUomId)) ? { yieldUomId: item.uomId } : {}),
      });
    }
  }

  function chooseIngredient(line, id) {
    const measuredIn = line.source === "RECIPE" ? recipeById.get(id)?.yieldUomId : itemById.get(id)?.uomId;
    const keepUnit = measuredIn && unitFamily(units, measuredIn).some((unit) => unit.id === line.uomId);
    setLine(line.key, line.source === "RECIPE" ? { subRecipeId: id, uomId: keepUnit ? line.uomId : measuredIn ?? "" } : { itemId: id, uomId: keepUnit ? line.uomId : measuredIn ?? "" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local, lineErrors: perLine } = recipePayload(form, {
      mode,
      includeCost,
      units,
      items,
      recipes,
      outputItem,
      selfId: recipe?.id ?? null,
    });
    setErrors(local);
    setLineErrors(perLine);
    if (Object.keys(local).length) {
      setFormError(local.lines && Object.keys(local).length === 1 ? local.lines : "Some fields need attention.");
      return;
    }

    setPending(true);
    setFormError(null);
    try {
      if (mode === "create") {
        const saved = await api.post("/admin/recipes", body);
        toast.success(existing ? `Saved as version ${saved.version}. It is the one in use now.` : "Recipe saved.");
        router.push(`/dashboard/recipes/${saved.id}`);
      } else if (mode === "revise") {
        const saved = await api.post(`/admin/recipes/${recipe.id}/revise`, body);
        toast.success(`Saved as version ${saved.version}. Version ${recipe.version} is kept as it was.`);
        router.push(`/dashboard/recipes/${saved.id}`);
      } else {
        await api.patch(`/admin/recipes/${recipe.id}`, body);
        toast.success("Recipe updated.");
        router.push(`/dashboard/recipes/${recipe.id}`);
      }
      router.refresh();
    } catch (failure) {
      const detail = detailOf(failure);
      setFormError(detail && detail !== failure?.message ? `${failure.message}. ${detail}` : failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  const productGroups = useMemo(() => {
    const groups = new Map();
    for (const variant of variants) {
      const key = variant.product.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(variant);
    }
    return [...groups.entries()];
  }, [variants]);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section
        title="What it makes"
        description={
          mode === "create"
            ? "A dish is made to order and its ingredients come off the shelf when it sells. A prep item — a sauce, a dough — is made in batches and kept in stock."
            : null
        }
      >
        {mode === "create" ? (
          <>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Kind of recipe</legend>
              {RECIPE_KINDS.map((kind) => (
                <label
                  key={kind.value}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-field px-4 py-2.5 text-label-bold ${form.kind === kind.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface hover:bg-surface-container"}`}
                >
                  <input type="radio" name="recipe-kind" value={kind.value} checked={form.kind === kind.value} onChange={() => set({ kind: kind.value })} className="size-4 accent-primary" />
                  {kind.label}
                </label>
              ))}
            </fieldset>

            {form.kind === "DISH" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="recipe-variant" className="text-label-bold text-on-surface">Dish</label>
                <select id="recipe-variant" value={form.variantId} onChange={(event) => chooseOutput("DISH", event.target.value)} aria-invalid={errors.variantId ? "true" : undefined} className={control(errors.variantId)}>
                  <option value="">Choose a dish</option>
                  {productGroups.map(([product, rows]) => (
                    <optgroup key={product} label={product}>
                      {rows.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {dishName(variant)}
                          {!variant.isActive || !variant.product.isActive ? " (switched off)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {errors.variantId ? <p className="text-label-bold text-error">{errors.variantId}</p> : null}
                {!variants.length ? <p className="text-body-md text-on-surface-variant">There are no dishes yet. <Link href="/dashboard/products" className="text-primary hover:underline">Add a product</Link> first.</p> : null}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <ItemSelect id="recipe-output" label="Prep item" value={form.outputItemId} onChange={(event) => chooseOutput("STOCK", event.target.value)} items={makeable} error={errors.outputItemId} placeholder="Choose what this makes" />
                {!makeable.length ? (
                  <p className="text-body-md text-on-surface-variant">
                    No item can be made yet. <Link href="/dashboard/inventory-items/new" className="text-primary hover:underline">Add one</Link> with the type &ldquo;Prepared in-house&rdquo; first — a raw material is bought, not made.
                  </p>
                ) : (
                  <p className="text-label-bold font-normal text-on-surface-variant">Raw materials are not listed: they are bought, not made.</p>
                )}
              </div>
            )}

            {existing ? (
              <p role="status" className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
                This already has a recipe — <Link href={`/dashboard/recipes/${existing.id}`} className="font-bold underline">{existing.name}, version {existing.version}</Link>. Saving this one makes it version {existing.version + 1} and the one in use. The old version is kept.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-body-md text-on-surface">
            {recipe.variant ? `${recipe.variant.product.name} — ${recipe.variant.name}` : recipe.outputItem?.name}
            <span className="block text-on-surface-variant">What a recipe makes cannot change. Start a new recipe for something else.</span>
          </p>
        )}

        <Field id="recipe-name" label="Recipe name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} maxLength={160} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="recipe-yield"
            label="One batch makes"
            inputMode="decimal"
            value={form.yieldQuantity}
            onChange={(event) => set({ yieldQuantity: event.target.value })}
            error={errors.yieldQuantity}
            hint={form.kind === "DISH" ? "Usually 1 — the ingredients are for one serving." : "The ingredients below are for this much."}
          />
          <SelectField
            id="recipe-yield-unit"
            label="Measured in"
            value={form.yieldUomId}
            onChange={(event) => set({ yieldUomId: event.target.value })}
            options={[{ value: "", label: "Choose a unit" }, ...unitOptions(yieldUnits)]}
            error={errors.yieldUomId}
          />
        </div>
      </Section>

      <Section title="Ingredients" description="Quantities are for one batch. Waste is extra loss in this recipe only — the item's own trimming loss is already allowed for.">
        {errors.lines && !Object.keys(lineErrors).length ? <p className="text-label-bold text-error">{errors.lines}</p> : null}
        <ul className="flex flex-col gap-3">
          {form.lines.map((line, index) => {
            const problems = lineErrors[index] ?? {};
            const id = line.source === "RECIPE" ? line.subRecipeId : line.itemId;
            const measuredIn = line.source === "RECIPE" ? recipeById.get(id)?.yieldUomId : itemById.get(id)?.uomId;
            const lineUnits = measuredIn ? unitFamily(units, measuredIn) : [];
            return (
              <li key={line.key} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <fieldset className="flex flex-wrap gap-1">
                    <legend className="sr-only">Ingredient {index + 1} is</legend>
                    {[
                      { value: "ITEM", label: "Stock item" },
                      { value: "RECIPE", label: "Another recipe" },
                    ].map((option) => (
                      <label key={option.value} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-field px-3 py-1.5 text-label-bold ${line.source === option.value ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:bg-surface-container"}`}>
                        <input
                          type="radio"
                          name={`${line.key}-source`}
                          value={option.value}
                          checked={line.source === option.value}
                          onChange={() => setLine(line.key, { source: option.value, itemId: "", subRecipeId: "", uomId: "" })}
                          className="size-4 accent-primary"
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  {form.lines.length > 1 ? (
                    <button type="button" onClick={() => set({ lines: form.lines.filter((row) => row.key !== line.key) })} className="inline-flex items-center gap-1 rounded-field px-3 py-2 text-label-bold text-error hover:bg-surface-container">
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  {line.source === "RECIPE" ? (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${line.key}-recipe`} className="text-label-bold text-on-surface">Recipe</label>
                      <select id={`${line.key}-recipe`} value={line.subRecipeId} onChange={(event) => chooseIngredient(line, event.target.value)} aria-invalid={problems.ingredient ? "true" : undefined} className={control(problems.ingredient)}>
                        <option value="">Choose a recipe</option>
                        {subRecipes.map((row) => (
                          <option key={row.id} value={row.id}>{row.name} ({row.yieldUom.code})</option>
                        ))}
                      </select>
                      {problems.ingredient ? <p className="text-label-bold text-error">{problems.ingredient}</p> : <p className="text-label-bold font-normal text-on-surface-variant">Made as part of this dish, not taken from stock.</p>}
                    </div>
                  ) : (
                    <ItemSelect id={`${line.key}-item`} label="Item" value={line.itemId} onChange={(event) => chooseIngredient(line, event.target.value)} items={items} error={problems.ingredient} />
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${line.key}-quantity`} className="text-label-bold text-on-surface">Quantity</label>
                    <input id={`${line.key}-quantity`} inputMode="decimal" value={line.quantity} onChange={(event) => setLine(line.key, { quantity: event.target.value })} aria-invalid={problems.quantity ? "true" : undefined} className={control(problems.quantity)} />
                    {problems.quantity ? <p className="text-label-bold text-error">{problems.quantity}</p> : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${line.key}-unit`} className="text-label-bold text-on-surface">Unit</label>
                    <select id={`${line.key}-unit`} value={line.uomId} onChange={(event) => setLine(line.key, { uomId: event.target.value })} disabled={!lineUnits.length} aria-invalid={problems.uomId ? "true" : undefined} className={`${control(problems.uomId)} disabled:opacity-60`}>
                      <option value="">{lineUnits.length ? "Choose" : "Pick the ingredient"}</option>
                      {lineUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>{unit.code}</option>
                      ))}
                    </select>
                    {problems.uomId ? <p className="text-label-bold text-error">{problems.uomId}</p> : null}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${line.key}-waste`} className="text-label-bold text-on-surface">Waste %</label>
                    <input id={`${line.key}-waste`} inputMode="decimal" placeholder="0" value={line.wastagePercent} onChange={(event) => setLine(line.key, { wastagePercent: event.target.value })} aria-invalid={problems.wastagePercent ? "true" : undefined} className={control(problems.wastagePercent)} />
                    {problems.wastagePercent ? <p className="text-label-bold text-error">{problems.wastagePercent}</p> : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${line.key}-note`} className="text-label-bold text-on-surface">Note</label>
                    <input id={`${line.key}-note`} placeholder="Optional, e.g. finely chopped" value={line.note} onChange={(event) => setLine(line.key, { note: event.target.value })} aria-invalid={problems.note ? "true" : undefined} className={control(problems.note)} />
                    {problems.note ? <p className="text-label-bold text-error">{problems.note}</p> : null}
                  </div>
                  <label htmlFor={`${line.key}-optional`} className="flex min-h-11 items-center gap-2 text-body-md text-on-surface">
                    <input id={`${line.key}-optional`} type="checkbox" checked={line.isOptional} onChange={(event) => setLine(line.key, { isOptional: event.target.checked })} className="size-4 accent-primary" />
                    Optional
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => set({ lines: [...form.lines, blankIngredient()] })} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
          <Plus aria-hidden="true" className="size-4" />
          Add an ingredient
        </button>
      </Section>

      <Section title="Method">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="recipe-prep" label="Prep time (minutes)" inputMode="numeric" value={form.prepTimeMinutes} onChange={(event) => set({ prepTimeMinutes: event.target.value })} error={errors.prepTimeMinutes} />
          <Field id="recipe-cook" label="Cook time (minutes)" inputMode="numeric" value={form.cookTimeMinutes} onChange={(event) => set({ cookTimeMinutes: event.target.value })} error={errors.cookTimeMinutes} />
        </div>
        <TextAreaField id="recipe-instructions" label="Instructions" rows={6} value={form.instructions} onChange={(event) => set({ instructions: event.target.value })} error={errors.instructions} hint="Optional. What the line needs to know to make it the same way every time." />
      </Section>

      {includeCost ? (
        <Section title="Labour and overhead" description="Per batch, on top of the ingredients. Leave blank for none.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="recipe-labor" label="Labour per batch" inputMode="decimal" value={form.laborCost} onChange={(event) => set({ laborCost: event.target.value })} error={errors.laborCost} />
            <Field id="recipe-overhead" label="Overhead per batch" inputMode="decimal" value={form.overheadCost} onChange={(event) => set({ overheadCost: event.target.value })} error={errors.overheadCost} hint="Gas, power, packaging not on the list." />
          </div>
        </Section>
      ) : null}

      <div className="flex flex-col gap-2">
        {mode === "revise" ? (
          <p className="text-body-md text-on-surface-variant">
            Version {recipe.version} has been used in production, so it stays exactly as it is. This is saved as version {recipe.version + 1} and becomes the one in use.
          </p>
        ) : null}
        <p className="text-body-md text-on-surface-variant">Recipes are shared by every branch — a change here is how it is made everywhere.</p>
        <div className="min-w-48 max-w-xs">
          <SubmitButton pending={pending} pendingLabel="Saving…">
            {mode === "revise" ? `Save as version ${recipe.version + 1}` : mode === "edit" ? "Save changes" : "Save recipe"}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

function dishName(variant) {
  if (!variant) return "";
  return variant.name && variant.name !== "Regular" ? `${variant.product.name} — ${variant.name}` : variant.product.name;
}
