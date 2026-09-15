"use client";

import { useState } from "react";
import { Check, MapPin, Plus, X } from "lucide-react";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";

const FIELDS = ["label", "recipientName", "phone", "line1", "line2", "city", "state", "postalCode", "deliveryNote"];

const BLANK = {
  label: "Home",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  deliveryNote: "",
};

/**
 * Where a delivery order is going.
 *
 * Saved addresses are chosen from rather than retyped, which is the entire
 * reason an address book exists — the previous checkout created a fresh address
 * row on every order, so a regular customer accumulated a duplicate of their
 * own house each time they ate.
 *
 * The address is only ever referenced by id from here on. The server snapshots
 * it onto the order at purchase, so editing or deleting it later never rewrites
 * where a past order actually went.
 */
export default function AddressPicker({ addresses, status, selectedId, onSelect, onCreated }) {
  const [adding, setAdding] = useState(false);

  if (status === "loading") {
    return <div aria-hidden="true" className="h-24 animate-pulse rounded-card bg-surface-container" />;
  }

  if (status === "error") {
    return (
      <FormAlert>We couldn&apos;t load your saved addresses. Add one below, or refresh the page.</FormAlert>
    );
  }

  const empty = addresses.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {empty && !adding ? (
        <p className="text-body-md text-on-surface-variant">
          You have no saved addresses yet. Add the one you&apos;d like this order delivered to.
        </p>
      ) : null}

      {addresses.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Delivery address</legend>

          {addresses.map((address) => {
            const active = address.id === selectedId;
            return (
              <label
                key={address.id}
                className={`flex cursor-pointer items-start gap-3 rounded-field px-4 py-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${
                  active ? "bg-primary-container text-on-primary-container" : "bg-surface-container-low text-on-surface hover:bg-surface-container"
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  value={address.id}
                  checked={active}
                  onChange={() => onSelect(address.id)}
                  className="sr-only"
                />
                <span aria-hidden="true" className="mt-0.5">
                  {active ? <Check className="size-5" /> : <MapPin className="size-5 text-on-surface-variant" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-label-bold">
                    {address.label}
                    {address.isDefault ? <span className="ml-2 font-normal opacity-70">Default</span> : null}
                  </span>
                  <span className={`block text-body-md ${active ? "opacity-90" : "text-on-surface-variant"}`}>
                    {[address.line1, address.line2, address.city, address.state, address.postalCode]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                  {address.phone ? (
                    <span className={`block text-body-md ${active ? "opacity-90" : "text-on-surface-variant"}`}>
                      {address.phone}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {adding ? (
        <NewAddressForm
          onCancel={() => setAdding(false)}
          onCreated={(address) => {
            setAdding(false);
            onCreated(address);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 self-start rounded-full bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-4" />
          {empty ? "Add an address" : "Add another address"}
        </button>
      )}
    </div>
  );
}

function NewAddressForm({ onCancel, onCreated }) {
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  function update(name) {
    return (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setErrors({});
    setFormError(null);

    try {
      // Optional fields are sent only when filled: the schema accepts them as
      // nullable, but an empty string is a value, and a stored "" is not the
      // same as "the customer didn't give us a second address line".
      const address = await api.post("/addresses", {
        label: form.label.trim(),
        phone: form.phone.trim(),
        line1: form.line1.trim(),
        ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        ...(form.deliveryNote.trim() ? { deliveryNote: form.deliveryNote.trim() } : {}),
      });
      onCreated(address);
    } catch (error) {
      const { fieldErrors, formError: message } = toFormErrors(error, { fields: FIELDS });
      setErrors(fieldErrors);
      setFormError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-low p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-label-bold text-on-surface">New address</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel adding an address"
          className="grid size-8 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {formError ? <FormAlert>{formError}</FormAlert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="address-label"
          label="Label"
          value={form.label}
          onChange={update("label")}
          error={errors.label}
          placeholder="Home"
          autoComplete="off"
          required
        />
        <Field
          id="address-phone"
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={update("phone")}
          error={errors.phone}
          placeholder="+92 300 1234567"
          autoComplete="tel"
          required
        />
      </div>

      <Field
        id="address-line1"
        label="Street address"
        value={form.line1}
        onChange={update("line1")}
        error={errors.line1}
        placeholder="House 12, Street 4"
        autoComplete="address-line1"
        required
      />

      <Field
        id="address-line2"
        label="Apartment, floor (optional)"
        value={form.line2}
        onChange={update("line2")}
        error={errors.line2}
        autoComplete="address-line2"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="address-city"
          label="City"
          value={form.city}
          onChange={update("city")}
          error={errors.city}
          autoComplete="address-level2"
          required
        />
        <Field
          id="address-state"
          label="Province"
          value={form.state}
          onChange={update("state")}
          error={errors.state}
          autoComplete="address-level1"
          required
        />
        <Field
          id="address-postal"
          label="Postal code"
          value={form.postalCode}
          onChange={update("postalCode")}
          error={errors.postalCode}
          autoComplete="postal-code"
          required
        />
      </div>

      <Field
        id="address-note"
        label="Directions for the rider (optional)"
        value={form.deliveryNote}
        onChange={update("deliveryNote")}
        error={errors.deliveryNote}
        placeholder="Green gate, ring twice"
      />

      <SubmitButton pending={pending}>Save address</SubmitButton>
    </form>
  );
}
