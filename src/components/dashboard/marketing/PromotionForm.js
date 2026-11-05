"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import {
  DAYS,
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_ORDER,
  coherenceProblems,
  conditionList,
  discountSummary,
  minuteFromInput,
  minuteToInput,
  promotionPayload,
  scheduleSummary,
  usesField,
  wouldNeverFire,
} from "@/lib/marketing";
import { toDateInput } from "@/lib/finance";

const CHANNELS = [
  { value: "WEB", label: "Website" },
  { value: "MOBILE_APP", label: "App" },
  { value: "QR", label: "QR code" },
  { value: "POS", label: "Counter" },
  { value: "PHONE", label: "Phone" },
  { value: "AGGREGATOR", label: "Aggregator" },
];

const ORDER_TYPES = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "PICKUP", label: "Collection" },
  { value: "DINE_IN", label: "Dine in" },
];

const newTarget = () => ({ key: Math.random().toString(36).slice(2), targetType: "CATEGORY", targetId: "", isExcluded: false, role: "" });

/** A set of checkboxes where "none ticked" honestly means "all of them". */
function Chooser({ legend, hint, options, selected, onToggle }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label-bold text-on-surface">{legend}</legend>
      <p className="text-body-md text-on-surface-variant">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-field px-4 text-label-bold ${on ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
            >
              <input type="checkbox" checked={on} onChange={() => onToggle(option.value)} className="size-4 accent-primary" />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Building an offer.
 *
 * The form is organised around one idea: **an offer that is wrong does not
 * fail, it just never fires**, and nothing afterwards tells you. So the
 * right-hand summary restates in plain words what the thing you are building
 * will actually do, and `wouldNeverFire` calls out the combinations that are
 * legal, saveable, and pointless — free delivery on a collection-only offer,
 * a buy-one-get-one with nothing to give away, an end date already in the
 * past.
 *
 * Only the inputs a given discount type uses are shown. A "buy quantity" box
 * on a percentage discount invites somebody to fill it in and then wonder
 * why nothing changed; the payload drops unused fields rather than storing
 * numbers the next reader has to interpret.
 *
 * Empty means "everywhere" throughout — no branches ticked is every branch,
 * no channels is every channel. That is what the server stores, so the form
 * says it rather than pretending a blank set is unset.
 */
export default function PromotionForm({ promotion = null, branches, targetNames = {}, canGoChainWide, currency }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    name: promotion?.name ?? "",
    description: promotion?.description ?? "",
    type: promotion?.type ?? "PERCENTAGE",
    value: promotion ? String(promotion.value ?? "") : "",
    maxDiscountAmount: promotion?.maxDiscountAmount != null ? String(promotion.maxDiscountAmount) : "",
    minOrderAmount: promotion?.minOrderAmount != null ? String(promotion.minOrderAmount) : "",
    minItemCount: promotion?.minItemCount != null ? String(promotion.minItemCount) : "",
    buyQuantity: promotion?.buyQuantity != null ? String(promotion.buyQuantity) : "",
    getQuantity: promotion?.getQuantity != null ? String(promotion.getQuantity) : "",
    branchIds: promotion?.branchIds ?? [],
    channels: promotion?.channels ?? [],
    orderTypes: promotion?.orderTypes ?? [],
    everyDay: !promotion?.daysOfWeek?.length,
    daysOfWeek: promotion?.daysOfWeek ?? [],
    startMinute: promotion?.startMinute ?? null,
    endMinute: promotion?.endMinute ?? null,
    overnight: (promotion?.endMinute ?? 0) >= 1440,
    startsAt: toDateInput(promotion?.startsAt),
    endsAt: toDateInput(promotion?.endsAt),
    newCustomersOnly: promotion?.newCustomersOnly ?? false,
    isStackable: promotion?.isStackable ?? false,
    priority: String(promotion?.priority ?? 0),
    usageLimit: promotion?.usageLimit != null ? String(promotion.usageLimit) : "",
    usageLimitPerUser: promotion?.usageLimitPerUser != null ? String(promotion.usageLimitPerUser) : "",
    requiresCoupon: promotion?.requiresCoupon ?? false,
    isActive: promotion?.isActive ?? true,
    targets: (promotion?.targets ?? []).map((target) => ({
      key: target.id ?? Math.random().toString(36).slice(2),
      targetType: target.targetType,
      targetId: target.targetId ?? "",
      isExcluded: target.isExcluded ?? false,
      role: target.role ?? "",
    })),
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  const problems = useMemo(() => coherenceProblems(form), [form]);
  const warnings = useMemo(() => wouldNeverFire(form), [form]);
  const ready = form.name.trim() && Object.keys(problems).length === 0;
  const definition = DISCOUNT_TYPES[form.type] ?? {};

  const set = (patch) => setForm((state) => ({ ...state, ...patch }));
  const toggle = (key, value) =>
    setForm((state) => ({
      ...state,
      [key]: state[key].includes(value) ? state[key].filter((item) => item !== value) : [...state[key], value],
    }));

  const setTarget = (key, patch) =>
    setForm((state) => ({ ...state, targets: state.targets.map((row) => (row.key === key ? { ...row, ...patch } : row)) }));

  function setTime(which, text) {
    const minute = minuteFromInput(text, { nextDay: which === "endMinute" && form.overnight });
    set({ [which]: text === "" ? null : minute });
  }

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (pending || !ready) return;

    setPending(true);
    setError(null);
    try {
      const payload = promotionPayload(form);
      if (promotion) {
        await api.patch(`/admin/promotions/${promotion.id}`, payload);
        toast.success("Saved.");
        router.push(`/dashboard/promotions/${promotion.id}`);
      } else {
        const made = await api.post("/admin/promotions", payload);
        toast.success("Offer created.");
        router.push(`/dashboard/promotions/${made.id}`);
      }
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <FormAlert>{error}</FormAlert>

        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">What it is</h2>

          <Field
            id="promo-name"
            label="Name"
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            hint="What staff will call it. Customers see the discount, not this."
            autoComplete="off"
            required
          />

          <SelectField
            id="promo-type"
            label="Kind of offer"
            value={form.type}
            onChange={(event) => set({ type: event.target.value })}
            options={DISCOUNT_TYPE_ORDER.map((key) => ({ value: key, label: DISCOUNT_TYPES[key].label }))}
            hint={definition.note}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {usesField(form.type, "value") ? (
              <Field
                id="promo-value"
                label={definition.unit === "%" ? "Percent off" : "Amount"}
                type="number"
                step="0.01"
                min="0"
                value={form.value}
                onChange={(event) => set({ value: event.target.value })}
                error={touched ? problems.value : null}
                autoComplete="off"
              />
            ) : null}

            {usesField(form.type, "maxDiscountAmount") ? (
              <Field
                id="promo-cap"
                label="Never take off more than"
                type="number"
                step="0.01"
                min="0"
                value={form.maxDiscountAmount}
                onChange={(event) => set({ maxDiscountAmount: event.target.value })}
                error={touched ? problems.maxDiscountAmount : null}
                hint="Leave empty for no cap. A percentage with no cap can get very large on a big order."
                autoComplete="off"
              />
            ) : null}

            {usesField(form.type, "buyQuantity") ? (
              <Field
                id="promo-buy"
                label="Buy this many"
                type="number"
                min="1"
                value={form.buyQuantity}
                onChange={(event) => set({ buyQuantity: event.target.value })}
                error={touched ? problems.buyQuantity : null}
                autoComplete="off"
              />
            ) : null}

            {usesField(form.type, "getQuantity") ? (
              <Field
                id="promo-get"
                label="Get this many free"
                type="number"
                min="1"
                value={form.getQuantity}
                onChange={(event) => set({ getQuantity: event.target.value })}
                error={touched ? problems.getQuantity : null}
                autoComplete="off"
              />
            ) : null}
          </div>

          <TextAreaField
            id="promo-description"
            label="Notes"
            value={form.description}
            onChange={(event) => set({ description: event.target.value })}
            rows={2}
            hint="Why this exists, for whoever finds it in six months."
          />
        </section>

        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Who gets it</h2>

          <Chooser
            legend="Branches"
            hint={
              canGoChainWide
                ? "None ticked means every branch, including any opened later."
                : "Pick the branches you cover. A chain-wide offer needs a company-wide role."
            }
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            selected={form.branchIds}
            onToggle={(value) => toggle("branchIds", value)}
          />
          {!canGoChainWide && !form.branchIds.length ? (
            <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
              With no branches ticked this would run at every outlet, which your role does not cover. Tick at least
              one.
            </p>
          ) : null}

          <Chooser
            legend="Channels"
            hint="None ticked means every channel."
            options={CHANNELS}
            selected={form.channels}
            onToggle={(value) => toggle("channels", value)}
          />

          <Chooser
            legend="Order types"
            hint="None ticked means every type."
            options={ORDER_TYPES}
            selected={form.orderTypes}
            onToggle={(value) => toggle("orderTypes", value)}
          />

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.newCustomersOnly}
              onChange={(event) => set({ newCustomersOnly: event.target.checked })}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">
              First order only
              <span className="block text-on-surface-variant">Only customers who have never ordered before.</span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">When it runs</h2>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.everyDay}
              onChange={(event) => set({ everyDay: event.target.checked, daysOfWeek: event.target.checked ? [] : form.daysOfWeek })}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">Every day of the week</span>
          </label>

          {!form.everyDay ? (
            <Chooser
              legend="Days"
              hint="Tick the days it should run."
              options={DAYS.map((day) => ({ value: day.value, label: day.label }))}
              selected={form.daysOfWeek}
              onToggle={(value) => toggle("daysOfWeek", value)}
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="promo-from-time"
              label="From"
              type="time"
              value={minuteToInput(form.startMinute)}
              onChange={(event) => setTime("startMinute", event.target.value)}
              error={touched ? problems.startMinute : null}
              hint="Leave both empty to run all day."
            />
            <Field
              id="promo-to-time"
              label="Until"
              type="time"
              value={minuteToInput(form.endMinute)}
              onChange={(event) => setTime("endMinute", event.target.value)}
              error={touched ? problems.endMinute : null}
            />
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.overnight}
              onChange={(event) => {
                const overnight = event.target.checked;
                const base = form.endMinute == null ? null : form.endMinute % 1440;
                set({ overnight, endMinute: base == null ? null : overnight ? base + 1440 : base });
              }}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">
              Runs past midnight
              <span className="block text-on-surface-variant">
                A late-night offer ending at 2am ends on the following day, not earlier the same one.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="promo-starts" label="Starts" type="date" value={form.startsAt} onChange={(event) => set({ startsAt: event.target.value })} />
            <Field
              id="promo-ends"
              label="Ends"
              type="date"
              value={form.endsAt}
              onChange={(event) => set({ endsAt: event.target.value })}
              error={touched ? problems.endsAt : null}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <div>
            <h2 className="font-display text-headline-md text-on-surface">What it applies to</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Nothing listed means the whole order. A target narrows it to a category, product or variant; marking one
              as an exclusion does the opposite — &ldquo;everything except drinks&rdquo;.
            </p>
          </div>

          {form.targets.length ? (
            <ul className="flex flex-col gap-3">
              {form.targets.map((target) => (
                <li key={target.key} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      id={`target-type-${target.key}`}
                      label="Kind"
                      value={target.targetType}
                      onChange={(event) => setTarget(target.key, { targetType: event.target.value, targetId: "" })}
                      options={[
                        { value: "CATEGORY", label: "Category" },
                        { value: "PRODUCT", label: "Product" },
                        { value: "VARIANT", label: "Variant" },
                        { value: "ORDER", label: "The whole order" },
                      ]}
                    />
                    {target.targetType !== "ORDER" ? (
                      <Field
                        id={`target-id-${target.key}`}
                        label="Id"
                        value={target.targetId}
                        onChange={(event) => setTarget(target.key, { targetId: event.target.value })}
                        hint={targetNames[target.targetId] ?? "Paste the id from the catalog screen."}
                        autoComplete="off"
                      />
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-body-md text-on-surface">
                      <input
                        type="checkbox"
                        checked={target.isExcluded}
                        onChange={(event) => setTarget(target.key, { isExcluded: event.target.checked })}
                        className="size-4 accent-primary"
                      />
                      Exclude this instead
                    </label>

                    {form.type === "BUY_X_GET_Y" ? (
                      <SelectField
                        id={`target-role-${target.key}`}
                        label="Side"
                        value={target.role}
                        onChange={(event) => setTarget(target.key, { role: event.target.value })}
                        options={[
                          { value: "", label: "Either" },
                          { value: "BUY", label: "The bought item" },
                          { value: "GET", label: "The free item" },
                        ]}
                      />
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setForm((state) => ({ ...state, targets: state.targets.filter((row) => row.key !== target.key) }))}
                      aria-label="Remove this target"
                      className="rounded-field p-2 text-on-surface-variant hover:bg-surface-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            onClick={() => setForm((state) => ({ ...state, targets: [...state.targets, newTarget()] }))}
            className="inline-flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add a target
          </button>
        </section>

        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Limits</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="promo-min-order"
              label="Minimum order"
              type="number"
              step="0.01"
              min="0"
              value={form.minOrderAmount}
              onChange={(event) => set({ minOrderAmount: event.target.value })}
              autoComplete="off"
            />
            <Field
              id="promo-min-items"
              label="Minimum items"
              type="number"
              min="1"
              value={form.minItemCount}
              onChange={(event) => set({ minItemCount: event.target.value })}
              autoComplete="off"
            />
            <Field
              id="promo-usage"
              label="Total redemptions"
              type="number"
              min="1"
              value={form.usageLimit}
              onChange={(event) => set({ usageLimit: event.target.value })}
              hint="Across everybody. Empty means no cap."
              autoComplete="off"
            />
            <Field
              id="promo-usage-per"
              label="Per customer"
              type="number"
              min="1"
              value={form.usageLimitPerUser}
              onChange={(event) => set({ usageLimitPerUser: event.target.value })}
              autoComplete="off"
            />
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.requiresCoupon}
              onChange={(event) => set({ requiresCoupon: event.target.checked })}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">
              Only with a code
              <span className="block text-on-surface-variant">
                Otherwise it applies automatically to every order that qualifies.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.isStackable}
              onChange={(event) => set({ isStackable: event.target.checked })}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">
              Can combine with other offers
              <span className="block text-on-surface-variant">
                Off means it competes with them, and the higher priority wins.
              </span>
            </span>
          </label>

          <Field
            id="promo-priority"
            label="Priority"
            type="number"
            value={form.priority}
            onChange={(event) => set({ priority: event.target.value })}
            hint="Higher wins when two offers cannot both apply."
            autoComplete="off"
          />
        </section>
      </div>

      <aside className="flex h-fit flex-col gap-4 lg:sticky lg:top-6">
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-high p-5">
          <h2 className="font-display text-headline-md text-on-surface">What this will do</h2>
          <p className="text-body-md text-on-surface" aria-live="polite">
            {discountSummary(form, { currency, formatMoney })}
          </p>
          <p className="text-body-md text-on-surface-variant">{scheduleSummary(form, { dateLabel: (value) => value })}</p>
          {conditionList(form, { currency, formatMoney }).length ? (
            <ul className="flex flex-col gap-1 text-body-md text-on-surface-variant">
              {conditionList(form, { currency, formatMoney }).map((condition) => (
                <li key={condition}>· {condition}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {warnings.length ? (
          <div role="status" className="flex flex-col gap-2 rounded-card bg-warning-container p-5 text-on-warning-container">
            <p className="text-label-bold">This would save, and do nothing</p>
            {warnings.map((warning) => (
              <p key={warning} className="text-body-md">
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <button
            type="submit"
            disabled={pending || !ready}
            className="rounded-field bg-primary-container px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : promotion ? "Save changes" : "Create the offer"}
          </button>
          {!ready && touched ? (
            <p className="text-body-md text-on-surface-variant">
              {form.name.trim() ? "One of the fields above needs fixing." : "Give it a name."}
            </p>
          ) : null}
        </div>
      </aside>
    </form>
  );
}
