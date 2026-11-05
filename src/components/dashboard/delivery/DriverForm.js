"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { VEHICLES, driverPayload } from "@/lib/delivery";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A driver.
 *
 * Built on top of a sign-in account rather than inventing a second identity:
 * a driver has to be able to open the driver app, and a driver record with
 * nobody behind it is a row that can never be given a job. Accounts that are
 * already a driver are not offered.
 *
 * `payoutPerDelivery` is the per-drop rate used when a payout is worked out.
 * Left blank it falls back to the branch setting, which is usually what you
 * want — a rate on every driver is a rate nobody remembers to change.
 */
export default function DriverForm({ accounts, branches, driver = null }) {
  const router = useRouter();
  const editing = Boolean(driver);

  const [form, setForm] = useState(() => ({
    userId: driver?.userId ?? "",
    branchId: driver?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    vehicleType: driver?.vehicleType ?? "MOTORCYCLE",
    vehicleNumber: driver?.vehicleNumber ?? "",
    licenseNumber: driver?.licenseNumber ?? "",
    licenseExpiry: driver?.licenseExpiry ? String(driver.licenseExpiry).slice(0, 10) : "",
    maxActiveOrders: driver?.maxActiveOrders != null ? String(driver.maxActiveOrders) : "3",
    payoutPerDelivery: driver?.payoutPerDelivery != null ? String(driver.payoutPerDelivery) : "",
    isActive: driver?.isActive !== false,
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = driverPayload(form, { isNew: !editing });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      const saved = editing ? await api.patch(`/admin/drivers/${driver.id}`, body) : await api.post("/admin/drivers", body);
      toast.success(editing ? "Driver saved." : "Driver added.");
      router.push(`/dashboard/drivers/${saved.id ?? driver.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Who they are">
        {editing ? (
          <p className="text-body-md text-on-surface">
            {driver.user?.name ?? "This driver"}
            <span className="block text-label-bold font-normal text-on-surface-variant">
              {driver.user?.phone ?? driver.user?.email ?? "No contact on the account"} — the account cannot be changed,
              only the driver record.
            </span>
          </p>
        ) : accounts.length ? (
          <SelectField
            id="driver-user"
            label="Account"
            value={form.userId}
            onChange={(event) => set({ userId: event.target.value })}
            options={[
              { value: "", label: "Choose the account they sign in with" },
              ...accounts.map((row) => ({ value: row.id, label: `${row.name ?? "Unnamed"} — ${row.phone ?? row.email ?? "no contact"}` })),
            ]}
            error={errors.userId}
            hint="They use this to sign in to the driver app. Accounts that are already a driver are not listed."
          />
        ) : (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            Every account is already a driver. Create the person&rsquo;s account under Users first, then come back.
          </p>
        )}

        {branches.length > 1 ? (
          <SelectField
            id="driver-branch"
            label="Branch"
            value={form.branchId}
            onChange={(event) => set({ branchId: event.target.value })}
            options={[{ value: "", label: "No home branch" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
            hint="Which outlet dispatches them. Without one they will not appear on any dispatch board."
          />
        ) : null}
      </Section>

      <Section title="What they ride">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="driver-vehicle"
            label="Vehicle"
            value={form.vehicleType}
            onChange={(event) => set({ vehicleType: event.target.value })}
            options={Object.entries(VEHICLES).map(([value, label]) => ({ value, label }))}
            error={errors.vehicleType}
          />
          <Field
            id="driver-plate"
            label="Registration"
            value={form.vehicleNumber}
            onChange={(event) => set({ vehicleNumber: event.target.value })}
            hint="Optional — useful when a customer rings about the rider outside."
            autoComplete="off"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="driver-licence"
            label="Licence number"
            value={form.licenseNumber}
            onChange={(event) => set({ licenseNumber: event.target.value })}
            autoComplete="off"
          />
          <Field
            id="driver-licence-expiry"
            label="Licence expires"
            type="date"
            value={form.licenseExpiry}
            onChange={(event) => set({ licenseExpiry: event.target.value })}
            error={errors.licenseExpiry}
            hint="Warned about on their page a month before. A rider on the road without one is the restaurant's problem too."
          />
        </div>
      </Section>

      <Section title="How they are worked">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="driver-max"
            label="Jobs at once"
            inputMode="numeric"
            value={form.maxActiveOrders}
            onChange={(event) => set({ maxActiveOrders: event.target.value })}
            error={errors.maxActiveOrders}
            hint="How many drops they can carry. Dispatch will not offer more."
            autoComplete="off"
          />
          <Field
            id="driver-rate"
            label="Rate per delivery"
            inputMode="decimal"
            value={form.payoutPerDelivery}
            onChange={(event) => set({ payoutPerDelivery: event.target.value })}
            error={errors.payoutPerDelivery}
            hint="Optional. Blank uses the branch's rate, which is usually the one you want to be able to change in one place."
            autoComplete="off"
          />
        </div>
        <label htmlFor="driver-active" className="flex items-start gap-3 rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface">
          <input
            id="driver-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set({ isActive: event.target.checked })}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            Riding for us
            <span className="block text-label-bold font-normal text-on-surface-variant">
              Turn this off when somebody leaves. Their deliveries and payouts stay — a delivery that cannot name who
              carried it is no use in a dispute.
            </span>
          </span>
        </label>
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save driver" : "Add driver"}</SubmitButton>
      </div>
    </form>
  );
}
