"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { QR_TARGETS, qrPayload } from "@/lib/service";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A code that ends up printed on a physical object.
 *
 * That is the constraint everything here follows from. The short code itself
 * can never be edited — it is on a sticker on a table, and changing it would
 * silently break every one already printed. What the code *points at* can be
 * changed freely, which is the whole point of having a redirect in the middle:
 * the poster stays up and the campaign behind it moves.
 *
 * Switching the target clears the fields the old target used. A stale
 * `tableId` left on a code that now opens the menu is how a sticker starts
 * seating people at a table that was deleted last year.
 */
export default function QrCodeForm({ branches, targets, tables, qrCode = null }) {
  const router = useRouter();
  const editing = Boolean(qrCode);

  const [form, setForm] = useState(() => ({
    branchId: qrCode?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    targetType: qrCode?.targetType ?? "MENU",
    menuId: qrCode?.menuId ?? "",
    tableId: qrCode?.tableId ?? "",
    categoryId: qrCode?.categoryId ?? "",
    productId: qrCode?.productId ?? "",
    customUrl: qrCode?.customUrl ?? "",
    label: qrCode?.label ?? "",
    isActive: qrCode?.isActive !== false,
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = qrPayload(form, { isNew: !editing });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      const saved = editing ? await api.patch(`/admin/qr-codes/${qrCode.id}`, body) : await api.post("/admin/qr-codes", body);
      toast.success(editing ? "Code updated." : `Code ${saved.code} created.`);
      router.push(`/dashboard/qr-codes/${saved.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  const target = QR_TARGETS[form.targetType];

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="What it opens">
        {branches.length > 1 && !editing ? (
          <SelectField
            id="qr-branch"
            label="Branch"
            value={form.branchId}
            onChange={(event) => set({ branchId: event.target.value, menuId: "", tableId: "" })}
            options={[{ value: "", label: "Choose a branch" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
            error={errors.branchId}
          />
        ) : null}

        <SelectField
          id="qr-target"
          label="Scanning it goes to"
          value={form.targetType}
          onChange={(event) => set({ targetType: event.target.value })}
          options={Object.entries(QR_TARGETS).map(([value, row]) => ({ value, label: row.label }))}
          error={errors.targetType}
          hint={target?.hint}
        />

        {form.targetType === "MENU" && targets.menus.length ? (
          <SelectField
            id="qr-menu"
            label="Which menu"
            value={form.menuId}
            onChange={(event) => set({ menuId: event.target.value })}
            options={[{ value: "", label: "Whichever is live at the time" }, ...targets.menus.map((row) => ({ value: row.id, label: row.name }))]}
            hint="Left open, it follows whatever menu is running when somebody scans — which is usually what a table talker wants."
          />
        ) : null}

        {form.targetType === "TABLE" ? (
          <SelectField
            id="qr-table"
            label="Which table"
            value={form.tableId}
            onChange={(event) => set({ tableId: event.target.value })}
            options={[{ value: "", label: "Choose a table" }, ...tables.map((row) => ({ value: row.id, label: row.area ? `${row.name} — ${row.area}` : row.name }))]}
            error={errors.tableId}
            hint="Orders scanned from this code arrive already tagged to the table."
          />
        ) : null}

        {form.targetType === "CATEGORY" ? (
          <SelectField
            id="qr-category"
            label="Which category"
            value={form.categoryId}
            onChange={(event) => set({ categoryId: event.target.value })}
            options={[{ value: "", label: "Choose a category" }, ...targets.categories.map((row) => ({ value: row.id, label: row.name }))]}
            error={errors.categoryId}
          />
        ) : null}

        {form.targetType === "PRODUCT" ? (
          <SelectField
            id="qr-product"
            label="Which item"
            value={form.productId}
            onChange={(event) => set({ productId: event.target.value })}
            options={[{ value: "", label: "Choose an item" }, ...targets.products.map((row) => ({ value: row.id, label: row.name }))]}
            error={errors.productId}
          />
        ) : null}

        {form.targetType === "CUSTOM_URL" ? (
          <Field
            id="qr-url"
            label="Address"
            type="url"
            value={form.customUrl}
            onChange={(event) => set({ customUrl: event.target.value })}
            error={errors.customUrl}
            hint="http or https only. A code is scanned by a stranger's phone, so other schemes are refused."
            autoComplete="off"
          />
        ) : null}
      </Section>

      <Section title="Housekeeping">
        <Field
          id="qr-label"
          label="Label"
          value={form.label}
          onChange={(event) => set({ label: event.target.value })}
          hint="For your own sake — “window poster”, “table talkers, terrace”. Never shown to a customer."
          autoComplete="off"
        />
        <label htmlFor="qr-active" className="flex items-start gap-3 rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface">
          <input
            id="qr-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set({ isActive: event.target.checked })}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            Live
            <span className="block text-label-bold font-normal text-on-surface-variant">
              Turn it off and the sticker stops working, politely. The code is never reused, so it can be turned back on.
            </span>
          </span>
        </label>
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save code" : "Create code"}</SubmitButton>
      </div>
      {editing ? (
        <p className="text-body-md text-on-surface-variant">
          The code itself ({qrCode.code}) cannot be changed — it is printed on something. Only where it points can move.
        </p>
      ) : null}
    </form>
  );
}
