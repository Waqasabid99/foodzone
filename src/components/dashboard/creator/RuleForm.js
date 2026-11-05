"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { BASIS_LABELS, REWARD_TYPES, rulePayload, ruleProblems, ruleWarnings } from "@/lib/creator";

const BLANK = {
  name: "",
  description: "",
  rewardType: "PERCENTAGE",
  rewardValue: "",
  basis: "ATTRIBUTED_LINE",
  maxRewardAmount: "",
  conditionBasis: "ORDER_TOTAL",
  minOrderAmount: "",
  minLineQuantity: "",
  branchIds: [],
  channels: [],
  orderTypes: [],
  creatorId: "",
  priority: 0,
  startsAt: "",
  endsAt: "",
  isActive: true,
  maxPayoutPerOrder: "",
  totalBudget: "",
};

/**
 * Writing a rule that pays money.
 *
 * Unlike most forms in this dashboard, the damage here is not a bad record —
 * it is an ongoing cost. A rule with no budget, no ceiling and no branches
 * named pays a share of every attributed sale in the company until somebody
 * notices, and nothing about it looks wrong on the screen afterwards.
 *
 * So the form separates two kinds of objection. `ruleProblems` is what the
 * API will refuse and blocks the button; `ruleWarnings` is what is legal but
 * probably unintended, shown as prose next to the save. The second list is
 * the one that matters — every item on it is a rule somebody could save today
 * without anything complaining.
 */
export default function RuleForm({
  rule = null,
  branches = [],
  creators = [],
  channels = [],
  orderTypes = [],
  canWriteChainWide = true,
  currency = null,
}) {
  const router = useRouter();
  const editing = Boolean(rule);
  const [form, setForm] = useState(() =>
    rule
      ? {
          ...BLANK,
          ...rule,
          description: rule.description ?? "",
          rewardValue: String(rule.rewardValue ?? ""),
          maxRewardAmount: rule.maxRewardAmount ?? "",
          minOrderAmount: rule.minOrderAmount ?? "",
          minLineQuantity: rule.minLineQuantity ?? "",
          maxPayoutPerOrder: rule.maxPayoutPerOrder ?? "",
          totalBudget: rule.totalBudget ?? "",
          creatorId: rule.creatorId ?? "",
          startsAt: rule.startsAt ? String(rule.startsAt).slice(0, 10) : "",
          endsAt: rule.endsAt ? String(rule.endsAt).slice(0, 10) : "",
          branchIds: rule.branchIds ?? [],
          channels: rule.channels ?? [],
          orderTypes: rule.orderTypes ?? [],
        }
      : BLANK,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));
  const toggle = (key, value) => () =>
    setForm((state) => ({
      ...state,
      [key]: state[key].includes(value) ? state[key].filter((row) => row !== value) : [...state[key], value],
    }));

  const problems = ruleProblems(form);
  const warnings = ruleWarnings(form);
  const chainWide = !form.branchIds.length;
  const blockedByReach = chainWide && !canWriteChainWide;

  async function submit(event) {
    event.preventDefault();
    if (pending || problems.length || blockedByReach) return;
    setPending(true);
    setError(null);
    try {
      const body = rulePayload(form);
      if (editing) {
        await api.patch(`/admin/creator-commission-rules/${rule.id}`, body);
        toast.success("Saved.");
      } else {
        await api.post("/admin/creator-commission-rules", body);
        toast.success("Rule created.");
      }
      router.push("/dashboard/commission-rules");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  const isPercentage = form.rewardType === "PERCENTAGE";

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FormAlert>{error}</FormAlert>

      <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">What it pays</h2>

        <Field id="rule-name" label="Name" value={form.name} onChange={set("name")} autoComplete="off" required />
        <Field
          id="rule-description"
          label="Description"
          value={form.description}
          onChange={set("description")}
          hint="Optional. Why this rule exists — the thing you will want in six months."
          autoComplete="off"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="rule-reward-type"
            label="Reward"
            value={form.rewardType}
            onChange={set("rewardType")}
            options={Object.entries(REWARD_TYPES).map(([value, row]) => ({ value, label: row.label }))}
            hint={REWARD_TYPES[form.rewardType]?.note}
          />
          <Field
            id="rule-reward-value"
            label={isPercentage ? "Percent" : `Amount${currency ? ` (${currency})` : ""}`}
            type="number"
            step={isPercentage ? "0.01" : "0.0001"}
            min="0"
            value={form.rewardValue}
            onChange={set("rewardValue")}
            autoComplete="off"
            required
          />
        </div>

        {isPercentage ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="rule-basis"
              label="Measured against"
              value={form.basis}
              onChange={set("basis")}
              options={Object.entries(BASIS_LABELS).map(([value, label]) => ({ value, label }))}
              hint="The attributed line is the item the video sold. The order total pays on everything else in the basket too."
            />
            <Field
              id="rule-max-reward"
              label="Ceiling"
              type="number"
              step="0.0001"
              min="0"
              value={form.maxRewardAmount}
              onChange={set("maxRewardAmount")}
              hint="The most one sale can pay. Empty means no limit."
              autoComplete="off"
            />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">When it applies</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="rule-condition-basis"
            label="Threshold looks at"
            value={form.conditionBasis}
            onChange={set("conditionBasis")}
            options={Object.entries(BASIS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Field
            id="rule-min-order"
            label="Minimum"
            type="number"
            step="0.0001"
            min="0"
            value={form.minOrderAmount}
            onChange={set("minOrderAmount")}
            hint="Below this, the rule does not apply. Empty means no minimum."
            autoComplete="off"
          />
          <Field
            id="rule-min-qty"
            label="Minimum quantity"
            type="number"
            min="1"
            value={form.minLineQuantity}
            onChange={set("minLineQuantity")}
            hint="Of the attributed item."
            autoComplete="off"
          />
          <Field
            id="rule-priority"
            label="Priority"
            type="number"
            value={form.priority}
            onChange={set("priority")}
            hint="Exactly one rule pays per sale. Higher wins first; ties go to the more specific rule."
            autoComplete="off"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rule-starts" label="Starts" type="date" value={form.startsAt} onChange={set("startsAt")} />
          <Field id="rule-ends" label="Ends" type="date" value={form.endsAt} onChange={set("endsAt")} />
        </div>

        <Checklist
          legend="Branches"
          hint={chainWide ? "None picked, so it pays at every branch — including ones opened later." : null}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          selected={form.branchIds}
          onToggle={(value) => toggle("branchIds", value)}
        />

        <Checklist
          legend="Channels"
          hint={form.channels.length ? null : "Any channel."}
          options={channels}
          selected={form.channels}
          onToggle={(value) => toggle("channels", value)}
        />

        <Checklist
          legend="Order types"
          hint={form.orderTypes.length ? null : "Any order type."}
          options={orderTypes}
          selected={form.orderTypes}
          onToggle={(value) => toggle("orderTypes", value)}
        />

        {creators.length ? (
          <SelectField
            id="rule-creator"
            label="One creator only"
            value={form.creatorId}
            onChange={set("creatorId")}
            options={[{ value: "", label: "Any creator" }, ...creators]}
            hint="A negotiated rate. A rule pinned to one creator beats a general one."
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">What it may cost</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="rule-max-per-order"
            label="Most per order"
            type="number"
            step="0.0001"
            min="0"
            value={form.maxPayoutPerOrder}
            onChange={set("maxPayoutPerOrder")}
            autoComplete="off"
          />
          <Field
            id="rule-budget"
            label="Total budget"
            type="number"
            step="0.0001"
            min="0"
            value={form.totalBudget}
            onChange={set("totalBudget")}
            hint="The rule stops paying once it has spent this."
            autoComplete="off"
          />
        </div>
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((state) => ({ ...state, isActive: event.target.checked }))}
            className="size-4 accent-primary"
          />
          Active
        </label>
      </section>

      {problems.length ? (
        <ul className="flex flex-col gap-1 rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {blockedByReach ? (
        <p className="rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          A rule with no branches named pays out at every outlet, so it needs a company-wide role. Pick the branches
          you cover, or ask somebody who holds the permission across the company.
        </p>
      ) : null}

      {warnings.length && !problems.length ? (
        <div className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          <p className="font-semibold">This will save. Worth checking first:</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || problems.length > 0 || blockedByReach || !form.name.trim() || !form.rewardValue}
          className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Create the rule"}
        </button>
      </div>
    </form>
  );
}

function Checklist({ legend, hint, options, selected, onToggle }) {
  if (!options.length) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label-bold text-on-surface">{legend}</legend>
      {hint ? <p className="text-body-md text-on-surface-variant">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              aria-pressed={on}
              className={`rounded-field px-4 py-2 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${on ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
