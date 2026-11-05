"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { productionPlanPayload } from "@/lib/production";
import { formatQuantity } from "@/lib/inventory";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * Plans a batch. Nothing leaves the shelf yet — the run's page shows what it
 * needs against what is there, and material is issued when it starts.
 */
export default function ProductionPlanForm({ recipes, locations, defaultRecipeId = "" }) {
  const router = useRouter();
  const [form, setForm] = useState(() => {
    const recipe = recipes.find((row) => row.id === defaultRecipeId);
    return {
      recipeId: recipe ? recipe.id : "",
      locationId: locations.length === 1 ? locations[0].id : locations.find((row) => row.type === "KITCHEN")?.id ?? "",
      plannedQuantity: recipe ? trim(recipe.yieldQuantity) : "",
      scheduledFor: "",
      batchNumber: "",
      notes: "",
    };
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const recipe = useMemo(() => recipes.find((row) => row.id === form.recipeId) ?? null, [recipes, form.recipeId]);
  const multiBranch = new Set(locations.map((location) => location.branchId)).size > 1;
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  function chooseRecipe(id) {
    const next = recipes.find((row) => row.id === id);
    const previous = recipe;
    // A quantity still at the old recipe's batch size follows the new one.
    const followsBatch = !form.plannedQuantity || (previous && form.plannedQuantity === trim(previous.yieldQuantity));
    set({ recipeId: id, ...(next && followsBatch ? { plannedQuantity: trim(next.yieldQuantity) } : {}) });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = productionPlanPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");
    setPending(true);
    setFormError(null);
    try {
      const run = await api.post("/admin/production-orders", body);
      toast.success(`${run.productionNumber} planned.`);
      router.push(`/dashboard/production/${run.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be planned.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>
      <Section title="What, where and how much">
        <SelectField
          id="plan-recipe"
          label="Recipe"
          value={form.recipeId}
          onChange={(event) => chooseRecipe(event.target.value)}
          options={[{ value: "", label: recipes.length ? "Choose what to make" : "No prep recipe yet" }, ...recipes.map((row) => ({ value: row.id, label: `${row.name} — makes ${row.outputItem.name}` }))]}
          error={errors.recipeId}
          hint={recipe ? `One batch makes ${formatQuantity(recipe.yieldQuantity, { precision: recipe.yieldUom.precision, unit: recipe.yieldUom.code })}. Version ${recipe.version}.` : "Only recipes for prep items are made in batches. Dishes are made to order."}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="plan-location"
            label="Made at"
            value={form.locationId}
            onChange={(event) => set({ locationId: event.target.value })}
            options={[{ value: "", label: "Choose a location" }, ...locations.map((location) => ({ value: location.id, label: multiBranch ? `${location.name} — ${location.branch.name}` : location.name }))]}
            error={errors.locationId}
            hint="Ingredients are taken from here, and the batch goes into stock here."
          />
          <Field
            id="plan-quantity"
            label={`How much to make${recipe ? ` (${recipe.yieldUom.code})` : ""}`}
            inputMode="decimal"
            value={form.plannedQuantity}
            onChange={(event) => set({ plannedQuantity: event.target.value })}
            error={errors.plannedQuantity}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="plan-date" label="For" type="date" value={form.scheduledFor} onChange={(event) => set({ scheduledFor: event.target.value })} error={errors.scheduledFor} hint="Optional." />
          {recipe?.outputItem.trackBatches ? (
            <Field id="plan-batch" label="Batch number" value={form.batchNumber} onChange={(event) => set({ batchNumber: event.target.value })} error={errors.batchNumber} hint="Optional. Blank uses the run number." />
          ) : null}
        </div>
        <TextAreaField id="plan-notes" label="Notes" rows={2} value={form.notes} onChange={(event) => set({ notes: event.target.value })} error={errors.notes} hint="Optional." />
      </Section>
      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Planning…">Plan the batch</SubmitButton>
      </div>
    </form>
  );
}

function trim(value) {
  const text = String(value ?? "");
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
