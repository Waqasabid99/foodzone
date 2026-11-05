"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { addressLine, addressPayload, addressProblems } from "@/lib/account";

const BLANK = {
  label: "",
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  state: "",
  postalCode: "",
  deliveryNote: "",
};

/**
 * Where the food goes.
 *
 * The fields that look optional and are not: a recipient name and a phone
 * number. A rider who cannot find the door rings; without a number the order
 * comes back. So those are required here even though an address is
 * recognisable without them.
 *
 * `landmark` and `deliveryNote` are the opposite — they look like clutter and
 * are the two fields that most often decide whether a delivery succeeds in a
 * place where street addressing is approximate.
 */
export default function AddressBook({ addresses }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));
  const problems = addressProblems(form);

  function startNew() {
    setForm(BLANK);
    setEditing("new");
    setError(null);
  }

  function startEdit(address) {
    setForm({ ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map((key) => [key, address[key] ?? ""])) });
    setEditing(address.id);
    setError(null);
  }

  async function save(event) {
    event.preventDefault();
    if (pending || problems.length) return;
    setPending(true);
    setError(null);
    try {
      if (editing === "new") {
        await api.post("/addresses", addressPayload(form));
        toast.success("Address saved.");
      } else {
        await api.patch(`/addresses/${editing}`, addressPayload(form));
        toast.success("Address updated.");
      }
      setEditing(null);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  async function act(label, call) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await call();
      toast.success(label);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {editing === null ? (
        <button
          type="button"
          onClick={startNew}
          className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Add an address
        </button>
      ) : null}

      {editing !== null ? (
        <form onSubmit={save} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">
            {editing === "new" ? "A new address" : "Edit this address"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="addr-label" label="Name it" value={form.label} onChange={set("label")} hint="Home, work — optional." autoComplete="off" />
            <Field id="addr-recipient" label="Who should the rider ask for?" value={form.recipientName} onChange={set("recipientName")} autoComplete="name" required />
            <Field id="addr-phone" label="Phone" value={form.phone} onChange={set("phone")} hint="Riders call when they cannot find a door." autoComplete="tel" required />
            <Field id="addr-city" label="City" value={form.city} onChange={set("city")} autoComplete="address-level2" required />
          </div>

          <Field id="addr-line1" label="Street address" value={form.line1} onChange={set("line1")} autoComplete="address-line1" required />
          <Field id="addr-line2" label="Flat, floor, building" value={form.line2} onChange={set("line2")} autoComplete="address-line2" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="addr-state" label="State or province" value={form.state} onChange={set("state")} autoComplete="address-level1" required />
            <Field id="addr-postal" label="Postal code" value={form.postalCode} onChange={set("postalCode")} autoComplete="postal-code" required />
          </div>

          <Field id="addr-landmark" label="Nearest landmark" value={form.landmark} onChange={set("landmark")} hint="Often the thing that actually gets it delivered." autoComplete="off" />

          <Field id="addr-note" label="Anything the rider should know" value={form.deliveryNote} onChange={set("deliveryNote")} hint="Gate code, which bell, where to leave it." autoComplete="off" />

          {problems.length ? (
            <ul className="flex flex-col gap-1 rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || problems.length > 0}
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save it"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Not now
            </button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col gap-3">
        {addresses.map((address) => (
          <li key={address.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-label-bold text-on-surface">{address.label || address.recipientName}</span>
                {address.isDefault ? (
                  <span className="rounded-full bg-secondary-container px-2.5 py-1 text-label-bold text-on-secondary-container">
                    Default
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-body-md text-on-surface-variant">{addressLine(address)}</p>
              <p className="text-body-md text-on-surface-variant">
                {address.recipientName}
                {address.phone ? ` · ${address.phone}` : ""}
              </p>
              {address.deliveryNote ? (
                <p className="mt-1 text-body-md text-on-surface-variant">“{address.deliveryNote}”</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {address.isDefault ? null : (
                <button
                  type="button"
                  onClick={() => act("Default address set.", () => api.post(`/addresses/${address.id}/default`, {}))}
                  className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
                >
                  Make default
                </button>
              )}
              <button
                type="button"
                onClick={() => startEdit(address)}
                className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => act("Address removed.", () => api.delete(`/addresses/${address.id}`))}
                className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
