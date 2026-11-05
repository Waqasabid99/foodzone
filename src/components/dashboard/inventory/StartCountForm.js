"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import SelectField from "@/components/ui/SelectField";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Opens a count sheet. The system's figures are frozen at this moment, so
 * start it when the counting is about to begin, not the night before.
 */
export default function StartCountForm({ locations, categories }) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : "");
  const [categoryId, setCategoryId] = useState("");
  const [scope, setScope] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const multiBranch = new Set(locations.map((location) => location.branchId)).size > 1;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    if (!locationId) return setError("Choose where you are counting.");
    setPending(true);
    setError(null);
    try {
      const category = categories.find((row) => row.id === categoryId);
      const count = await api.post("/admin/stock-counts", {
        locationId,
        ...(categoryId ? { categoryId } : {}),
        ...(scope.trim() || category ? { scope: scope.trim() || category.name } : {}),
      });
      toast.success(`Count ${count.countNumber} started.`);
      router.push(`/dashboard/stock-counts/${count.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be started.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Start a count" className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Start a count</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">Counting part of a store room — one category, one shelf — is normal. Leave the category blank to count everything held there.</p>
      </div>
      <FormAlert>{error}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          id="count-location"
          label="Where"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={[{ value: "", label: "Choose a location" }, ...locations.map((location) => ({ value: location.id, label: multiBranch ? `${location.name} — ${location.branch.name}` : location.name }))]}
        />
        <SelectField
          id="count-category"
          label="What"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={[{ value: "", label: "Everything held there" }, ...categories.map((row) => ({ value: row.id, label: row.name }))]}
        />
        <Field id="count-scope" label="Label" placeholder="Optional, e.g. Walk-in, top shelf" value={scope} onChange={(event) => setScope(event.target.value)} />
      </div>
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Starting…" : "Start counting"}
      </button>
    </form>
  );
}
