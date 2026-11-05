"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Opening a financial year.
 *
 * The periods page has always said a year "has to be created before the books
 * have months to post into", and until now there was nothing behind that
 * sentence — the endpoint existed and no screen called it, so opening next
 * year meant somebody writing a request by hand at the one moment of the
 * calendar when nobody has time for that.
 *
 * Collapsed by default. This is a once-a-year action sitting on a page people
 * open every month to close a period, and a form that is always expanded reads
 * as the main thing on the screen when it is the rarest.
 *
 * The months themselves are generated server-side from the dates, not typed:
 * a year with a missing month is a hole that only surfaces when something
 * tries to post into it, which is to say at the worst possible time.
 */
export default function FiscalYearForm({ suggestion }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(suggestion);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));

  // Checked here as well as on the server so the obvious mistake — an end date
  // before the start — is caught before a round trip rather than after it.
  const backwards = Boolean(form.startDate && form.endDate && form.endDate <= form.startDate);
  const incomplete = !form.name.trim() || !form.startDate || !form.endDate;

  async function submit(event) {
    event.preventDefault();
    if (pending || incomplete || backwards) return;

    setPending(true);
    setError(null);

    try {
      const year = await api.post("/admin/fiscal-years", {
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
      });

      toast.success(`${form.name.trim()} is open, with its months generated.`);
      setOpen(false);
      // Straight to the year just created, rather than leaving them looking at
      // the old one wondering whether it worked.
      router.push(`/dashboard/periods?year=${year.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Open a financial year
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <FormAlert>{error}</FormAlert>

      <div>
        <h2 className="font-display text-headline-md text-on-surface">Open a financial year</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Its months are generated from these dates. Nothing can be posted into a month that does not exist, so this
          is what has to happen before the first entry of the year.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="fy-name" label="Name" value={form.name} onChange={set("name")} required />
        <Field id="fy-start" label="First day" type="date" value={form.startDate} onChange={set("startDate")} required />
        <Field
          id="fy-end"
          label="Last day"
          type="date"
          value={form.endDate}
          onChange={set("endDate")}
          error={backwards ? "The last day has to come after the first." : null}
          required
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || incomplete || backwards}
          className="rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container disabled:opacity-60 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Opening…" : "Open the year"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
