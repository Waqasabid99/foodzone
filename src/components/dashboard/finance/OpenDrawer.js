"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { drawerPayload } from "@/lib/finance";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Starting a shift against a drawer.
 *
 * The endpoint and the permission for this were there from the first day and
 * nothing ever called them, so the only way a session could begin was through
 * the API — and the empty state on this page cheerfully explained that a
 * session opens when a cashier starts a shift, with no way to start one.
 *
 * The float is the point of the whole exercise. It is the one number in the
 * shift that is known for certain at the start, and the variance at the end is
 * measured from it, so it is asked for plainly rather than defaulted away.
 */
export default function OpenDrawer({ branches = [], defaultName = "Counter 1" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ branchId: branches[0]?.id ?? "", registerName: defaultName, openingFloat: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = drawerPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setError("Check the drawer before opening it.");

    setPending(true);
    setError(null);
    try {
      const session = await api.post("/admin/registers", body);
      toast.success(`${body.registerName} is open.`);
      setOpen(false);
      router.push(`/dashboard/registers/${session.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "The drawer could not be opened.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Open a drawer
      </button>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Open a drawer</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Count what is in the till before you start and type it in. Everything that moves through the drawer is added
          to that figure, and what you count at the end is measured against the total.
        </p>
      </div>

      <FormAlert>{error}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-3">
        {branches.length > 1 ? (
          <SelectField
            id="drawer-branch"
            label="Branch"
            value={form.branchId}
            onChange={(event) => set({ branchId: event.target.value })}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            error={errors.branchId}
          />
        ) : null}
        <Field
          id="drawer-name"
          label="Which drawer"
          value={form.registerName}
          onChange={(event) => set({ registerName: event.target.value })}
          error={errors.registerName}
          hint="The name on the till, so a variance has somewhere to land."
          autoComplete="off"
        />
        <Field
          id="drawer-float"
          label="Opening float"
          inputMode="decimal"
          value={form.openingFloat}
          onChange={(event) => set({ openingFloat: event.target.value })}
          error={errors.openingFloat}
          hint="What is in it right now. Zero is fine if it is empty."
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Opening…" : "Open it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-field bg-surface-container-high px-5 py-3 text-label-bold text-on-surface hover:bg-surface-container-highest"
        >
          Not now
        </button>
      </div>
    </form>
  );
}
