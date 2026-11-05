"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { MENU_FIELDS, MENU_TYPES, WEEKDAYS, describeSchedule, menuFormValues, menuPayload } from "@/lib/menu-schedule";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import SelectField from "@/components/ui/SelectField";
import SubmitButton from "@/components/ui/SubmitButton";
import TextAreaField from "@/components/ui/TextAreaField";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/** Server field names → the form's, so a refusal lands under the control that caused it. */
const SERVER_TO_FORM = { startMinute: "start", endMinute: "end", activeFrom: "from", activeTo: "to", daysOfWeek: "days" };

/**
 * A menu's name, channel and schedule.
 *
 * Times and dates are entered in the branch's timezone and said to be, because
 * the person scheduling a branch's lunch menu is not always standing in it.
 * Switching the menu on is not here: it is a separate permission, and a
 * separate button, on the menu's page.
 */
export default function MenuForm({ menu = null, branches = [], defaultBranchId = "", liveMenus = [], readOnly = false }) {
  const router = useRouter();
  const creating = !menu;
  const [form, setForm] = useState(() =>
    menuFormValues(menu, { timezone: menu?.branch?.timezone ?? "UTC", branchId: defaultBranchId || (branches.length === 1 ? branches[0].id : "") }),
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const update = (key) => (event) => set(key, event.target.value);

  const branch = creating ? branches.find((option) => option.id === form.branchId) : menu.branch;

  /*
   * Whether creating this would displace a menu customers are ordering from.
   *
   * It decides the default for "live", and it is the thing worth saying out
   * loud: a new menu is empty, and an empty menu that wins the pick leaves a
   * branch with nothing to sell.
   */
  const typeLabel = (MENU_TYPES.find((entry) => entry.value === form.type)?.label ?? "menu").toLowerCase();
  const displaces = creating && (liveMenus ?? []).some((row) => row.branchId === form.branchId && row.type === form.type);
  const timezone = branch?.timezone ?? "UTC";
  const typeHint = MENU_TYPES.find((entry) => entry.value === form.type)?.hint;
  const draft = menuPayload(form, { creating, timezone });
  const preview = Object.keys(draft.errors).some((key) => ["start", "end", "from", "to"].includes(key))
    ? null
    : describeSchedule({ ...draft.body, daysOfWeek: draft.body.daysOfWeek }, timezone);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || readOnly) return;
    const { body, errors: local } = menuPayload(form, { creating, timezone });
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError("Some fields need attention.");
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) {
        const created = await api.post("/admin/menus", body);
        toast.success(`${created.name} created. Add products, then switch it on.`);
        router.push(`/dashboard/menus/${created.id}`);
      } else {
        await api.patch(`/admin/menus/${menu.id}`, body);
        toast.success("Menu saved.");
        setPending(false);
      }
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: MENU_FIELDS });
      setErrors(Object.fromEntries(Object.entries(mapped.fieldErrors).map(([key, value]) => [SERVER_TO_FORM[key] ?? key, value])));
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  const toggleDay = (day) => set("days", form.days.includes(day) ? form.days.filter((value) => value !== day) : [...form.days, day]);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
        <Section
          title="The menu"
          description={
            creating
              ? displaces
                ? `${branch?.name ?? "This branch"} already has a live ${typeLabel} menu. A new one starts switched off so it cannot replace it before it has anything on it.`
                : "This is the first menu of its kind here, so it goes live as soon as it is created."
              : null
          }
        >
          {creating ? (
            <SelectField
              id="menu-branch"
              label="Branch"
              value={form.branchId}
              onChange={update("branchId")}
              error={errors.branchId}
              options={[{ value: "", label: "Choose a branch", disabled: true }, ...branches.map((option) => ({ value: option.id, label: option.isActive ? option.name : `${option.name} (not trading)` }))]}
            />
          ) : null}
          <Field id="menu-name" label="Name" required autoFocus={creating} placeholder="e.g. All day, Lunch, Ramadan iftar" value={form.name} onChange={update("name")} error={errors.name} />
          <SelectField
            id="menu-type"
            label="Used for"
            value={form.type}
            onChange={update("type")}
            error={errors.type}
            hint={typeHint}
            options={MENU_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))}
          />
          <TextAreaField id="menu-description" label="Description" rows={2} value={form.description} onChange={update("description")} error={errors.description} hint="Optional. For your team; customers do not see it." />
          <label className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4">
            <input type="checkbox" checked={form.isDefault} onChange={(event) => set("isDefault", event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
            <span>
              <span className="block text-label-bold text-on-surface">Fallback menu</span>
              <span className="block text-body-md text-on-surface-variant">
                When two menus for the same channel are equally scheduled, this one wins. A branch has one per channel, so choosing this replaces the current one.
              </span>
            </span>
          </label>
        </Section>

        <Section
          title="When it shows"
          description={branch ? `Times and dates are in ${branch.name}'s timezone (${timezone}).` : "Choose a branch first; times are in its timezone."}
        >
          <fieldset>
            <legend className="mb-2 text-label-bold text-on-surface">Days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const on = form.days.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={on}
                    aria-label={day.long}
                    onClick={() => toggleDay(day.value)}
                    className={`min-w-14 rounded-field px-3 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                      on ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"
                    }`}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-label-bold font-normal text-on-surface-variant">None picked means every day.</p>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="menu-start" label="From" type="time" value={form.start} onChange={update("start")} error={errors.start} hint="Leave both times empty for all day." />
            <Field id="menu-end" label="Until" type="time" value={form.end} onChange={update("end")} error={errors.end} hint="Earlier than the start runs past midnight, e.g. 20:00 until 02:00." />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="menu-from" label="First day" type="date" value={form.from} onChange={update("from")} error={errors.from} hint="Optional, for a seasonal menu." />
            <Field id="menu-to" label="Last day" type="date" value={form.to} onChange={update("to")} error={errors.to} hint="Optional. It shows until the end of this day." />
          </div>

          {preview ? (
            <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface" aria-live="polite">
              <span className="text-label-bold">Shows: </span>
              {preview}
            </p>
          ) : null}
        </Section>
      </fieldset>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <SubmitButton pending={pending} pendingLabel={creating ? "Creating…" : "Saving…"}>
              {creating ? "Create menu" : "Save menu"}
            </SubmitButton>
          </div>
          {creating ? (
            <Link href="/dashboard/menus" className="rounded-field px-5 py-3.5 text-label-bold text-on-surface-variant hover:text-on-surface">
              Cancel
            </Link>
          ) : null}
        </div>
      )}
    </form>
  );
}
