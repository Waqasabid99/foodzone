"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { BRANCH_FIELDS, branchFormValues, branchPayload } from "@/lib/branch-form";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";

/**
 * Every IANA zone the runtime knows, so the value cannot be a typo.
 *
 * The server validates the string by constructing a `DateTimeFormat` with it,
 * and opening hours are stored as minutes in this zone — a branch saved as
 * "Asia/Karachi " or "PKT" would either be rejected on save or, worse, keep
 * yesterday's schedule and open at the wrong hour. A list removes the question.
 */
const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    // Older runtimes: the common zones are still better than a free-text box.
    return ["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Europe/London", "America/New_York", "UTC"];
  }
})();

/**
 * Create or edit a branch.
 *
 * One component for both because the fields, the rules and the mistakes are the
 * same; only the verb and the endpoint differ. A separate create form would
 * drift from the edit form field by field until the two disagreed about what a
 * branch is.
 *
 * Submitting goes through the public API rather than a server action on
 * purpose. That path already carries the permission check, the branch-scope
 * check, rate limiting, the audit entry and the storefront cache invalidation —
 * and it is the same endpoint the mobile app will call. A server action would
 * be a second way in, with all of that to re-implement or to forget.
 */
export default function BranchForm({ branch = null, currency }) {
  const router = useRouter();
  const editing = Boolean(branch);

  const [form, setForm] = useState(() => branchFormValues(branch));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const error = (key) => fieldErrors[key] ?? null;

  /**
   * The two the server would also catch, checked here first.
   *
   * On a PATCH an omitted field means "unchanged", so a cleared name would be a
   * round trip that appears to succeed and changes nothing. Better to say so
   * before sending.
   */
  function localErrors() {
    const errors = {};
    if (!form.name.trim()) errors.name = "Give the branch a name";
    if (!form.code.trim()) errors.code = "Give the branch a code";
    return errors;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const local = localErrors();
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setFormError(null);
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const payload = branchPayload(form);
      const saved = editing
        ? await api.patch(`/admin/branches/${branch.id}`, payload)
        : await api.post("/admin/branches", payload);

      toast.success(editing ? "Branch updated." : `${saved.name} created.`);

      router.push(`/dashboard/branches/${saved.id}`);
      // The list and the detail page are server-rendered, so the new figures
      // only appear if the router cache is dropped.
      router.refresh();
    } catch (failure) {
      const { fieldErrors: fields, formError: message } = toFormErrors(failure, {
        fields: BRANCH_FIELDS,
        // The only uniqueness constraint on a branch is its code, so a conflict
        // can only be about that one box.
        conflictField: "code",
      });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Identity" description="How this outlet is named on receipts and in reports.">
        <Field
          id="branch-name"
          label="Branch name"
          required
          autoFocus={!editing}
          placeholder="e.g. Gulberg"
          value={form.name}
          onChange={update("name")}
          error={error("name")}
        />
        <Field
          id="branch-code"
          label="Code"
          required
          placeholder="e.g. GLB-01"
          value={form.code}
          onChange={update("code")}
          error={error("code")}
          hint={
            editing
              ? "Saved in upper case. Changing it will not rewrite the code on orders already placed."
              : "Letters, numbers and hyphens. Saved in upper case."
          }
        />
        <Field
          id="branch-legal-name"
          label="Registered name"
          placeholder="e.g. FoodZone Pvt Ltd"
          value={form.legalName}
          onChange={update("legalName")}
          error={error("legalName")}
          hint="Optional. Used on invoices when it differs from the branch name."
        />
        <Field
          id="branch-tax-id"
          label="Tax identifier"
          placeholder="e.g. NTN 1234567-8"
          value={form.taxIdentifier}
          onChange={update("taxIdentifier")}
          error={error("taxIdentifier")}
        />
      </Section>

      <Section title="Contact" description="Where customers and couriers reach this branch.">
        <Field
          id="branch-phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          placeholder="e.g. +92 300 1234567"
          value={form.phone}
          onChange={update("phone")}
          error={error("phone")}
        />
        <Field
          id="branch-email"
          label="Email"
          type="email"
          placeholder="e.g. gulberg@foodzone.pk"
          value={form.email}
          onChange={update("email")}
          error={error("email")}
        />
      </Section>

      <Section title="Address" description="Shown to customers and used on delivery paperwork.">
        <Field
          id="branch-address-1"
          label="Address line 1"
          value={form.addressLine1}
          onChange={update("addressLine1")}
          error={error("addressLine1")}
        />
        <Field
          id="branch-address-2"
          label="Address line 2"
          value={form.addressLine2}
          onChange={update("addressLine2")}
          error={error("addressLine2")}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="branch-city"
            label="City"
            value={form.city}
            onChange={update("city")}
            error={error("city")}
          />
          <Field
            id="branch-state"
            label="State or province"
            value={form.state}
            onChange={update("state")}
            error={error("state")}
          />
          <Field
            id="branch-postal"
            label="Postal code"
            value={form.postalCode}
            onChange={update("postalCode")}
            error={error("postalCode")}
          />
          <Field
            id="branch-country"
            label="Country"
            maxLength={2}
            placeholder="PK"
            value={form.country}
            onChange={(event) =>
              setForm((current) => ({ ...current, country: event.target.value.toUpperCase() }))
            }
            error={error("country")}
            hint="Two-letter country code."
          />
        </div>
      </Section>

      <Section
        title="Delivery area"
        description="Coordinates place the branch on the map; the radius decides how far it will deliver."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="branch-latitude"
            label="Latitude"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="e.g. 31.5204"
            value={form.latitude}
            onChange={update("latitude")}
            error={error("latitude")}
          />
          <Field
            id="branch-longitude"
            label="Longitude"
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="e.g. 74.3587"
            value={form.longitude}
            onChange={update("longitude")}
            error={error("longitude")}
          />
        </div>

        <Field
          id="branch-radius"
          label="Delivery radius (km)"
          type="number"
          step="any"
          min="0"
          max="200"
          inputMode="decimal"
          value={form.deliveryRadiusKm}
          onChange={update("deliveryRadiusKm")}
          error={error("deliveryRadiusKm")}
          hint="Leave blank if this branch does not deliver."
        />
      </Section>

      <Section title="Trading" description="How this branch keeps time and money, and whether it is live.">
        <SelectField
          id="branch-timezone"
          label="Timezone"
          value={form.timezone}
          onChange={update("timezone")}
          error={error("timezone")}
          hint="Opening hours are read in this zone."
          options={TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
        />

        <Field
          id="branch-currency"
          label="Currency"
          maxLength={3}
          placeholder={currency}
          value={form.currency}
          onChange={(event) =>
            setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
          }
          error={error("currency")}
          hint={
            editing
              ? "Three-letter code. Orders already placed keep the amounts they were taken at — changing this does not convert them."
              : "Three-letter code."
          }
        />

        <Field
          id="branch-opened"
          label="Opened on"
          type="date"
          value={form.openedAt}
          onChange={update("openedAt")}
          error={error("openedAt")}
          hint="Optional. Used to date this branch's figures from."
        />

        <label
          htmlFor="branch-active"
          className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4"
        >
          <input
            id="branch-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            className="mt-0.5 size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <span>
            <span className="block text-label-bold text-on-surface">Open for orders</span>
            <span className="block text-body-md text-on-surface-variant">
              Turning this off removes the branch from the website and the app straight away. Orders already
              in the kitchen are not affected.
            </span>
          </span>
        </label>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <SubmitButton pending={pending} pendingLabel={editing ? "Saving…" : "Creating…"}>
            {editing ? "Save changes" : "Create branch"}
          </SubmitButton>
        </div>
        <Link
          href={editing ? `/dashboard/branches/${branch.id}` : "/dashboard/branches"}
          className="rounded-field px-5 py-3.5 text-label-bold text-on-surface-variant hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">{description}</p>
      </div>
      {children}
    </section>
  );
}
