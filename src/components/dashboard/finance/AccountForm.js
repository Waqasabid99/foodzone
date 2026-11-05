"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_ORDER, accountPayload, defaultNormalBalance } from "@/lib/finance";

/**
 * Adding an account to the chart, or editing one.
 *
 * Code, type and normal balance are fixed once anything has posted to the
 * account, and the form says why rather than just disabling the fields:
 * changing them would reinterpret every line already written against it — the
 * same numbers, suddenly meaning something else.
 *
 * The normal balance follows the type unless it is deliberately overridden.
 * Assets and expenses are debit accounts; everything else is credit. Getting
 * this wrong makes the account's balance display with the sign inverted
 * everywhere it appears, which reads as a data problem rather than a setup
 * one.
 */
export default function AccountForm({ account = null, parents = [], branches = [], locked = false }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    code: account?.code ?? "",
    name: account?.name ?? "",
    type: account?.type ?? "EXPENSE",
    subType: account?.subType ?? "",
    normalBalance: account?.normalBalance ?? defaultNormalBalance(account?.type ?? "EXPENSE"),
    parentId: account?.parentId ?? "",
    branchId: account?.branchId ?? "",
    description: account?.description ?? "",
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const ready = form.code.trim() && form.name.trim();

  function setType(type) {
    // The side follows the type, because the pairing is a rule of the system
    // rather than a preference. It can still be overridden below.
    setForm((state) => ({ ...state, type, normalBalance: defaultNormalBalance(type) }));
  }

  async function submit(event) {
    event.preventDefault();
    if (pending || !ready) return;

    setPending(true);
    setError(null);
    try {
      const payload = accountPayload(form);
      if (account) {
        // Only what may still change is sent; the rest would be refused.
        const editable = locked
          ? { name: payload.name, subType: payload.subType, parentId: payload.parentId, description: payload.description }
          : payload;
        await api.patch(`/admin/accounts/${account.id}`, editable);
        toast.success("Saved.");
        router.push(`/dashboard/accounts/${account.id}`);
      } else {
        const created = await api.post("/admin/accounts", payload);
        toast.success("Account created.");
        router.push(`/dashboard/accounts/${created.id}`);
      }
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5">
      <FormAlert>{error}</FormAlert>

      {locked ? (
        <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
          This account already has entries posted to it, so its code, type and side are fixed. Changing them would
          reinterpret every line ever written against it — the same figures, meaning something else.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field
          id="account-code"
          label="Code"
          value={form.code}
          onChange={(event) => setForm((state) => ({ ...state, code: event.target.value }))}
          hint="Such as 4000."
          autoComplete="off"
          disabled={locked}
          required
        />
        <Field
          id="account-name"
          label="Name"
          value={form.name}
          onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
          autoComplete="off"
          required
        />
      </div>

      <SelectField
        id="account-type"
        label="Type"
        value={form.type}
        onChange={(event) => setType(event.target.value)}
        options={ACCOUNT_TYPE_ORDER.map((key) => ({ value: key, label: ACCOUNT_TYPES[key].label }))}
        hint={ACCOUNT_TYPES[form.type]?.note}
        disabled={locked}
      />

      <SelectField
        id="account-side"
        label="Normal balance"
        value={form.normalBalance}
        onChange={(event) => setForm((state) => ({ ...state, normalBalance: event.target.value }))}
        options={[
          { value: "DEBIT", label: "Debit" },
          { value: "CREDIT", label: "Credit" },
        ]}
        hint={
          form.normalBalance === defaultNormalBalance(form.type)
            ? "The usual side for this type."
            : "Unusual for this type — worth being sure. It inverts how every balance on this account reads."
        }
        disabled={locked}
      />

      <Field
        id="account-subtype"
        label="Sub-type"
        value={form.subType}
        onChange={(event) => setForm((state) => ({ ...state, subType: event.target.value }))}
        hint="Such as Cash, Bank or Inventory. The posting rules find some accounts by this."
        autoComplete="off"
      />

      <SelectField
        id="account-parent"
        label="Sits under"
        value={form.parentId}
        onChange={(event) => setForm((state) => ({ ...state, parentId: event.target.value }))}
        options={[{ value: "", label: "Top level" }, ...parents.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))]}
        hint="Only for grouping in the chart. It does not change where anything posts."
      />

      {branches.length ? (
        <SelectField
          id="account-branch"
          label="Belongs to"
          value={form.branchId}
          onChange={(event) => setForm((state) => ({ ...state, branchId: event.target.value }))}
          options={[{ value: "", label: "The whole company" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
          hint="Nearly always the whole company. One outlet's own till is the exception."
        />
      ) : null}

      <TextAreaField
        id="account-description"
        label="What belongs in here"
        value={form.description}
        onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))}
        rows={2}
        hint="The note that stops the next person posting the wrong thing to it."
      />

      <button
        type="submit"
        disabled={pending || !ready}
        className="w-fit rounded-field bg-primary-container px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Saving…" : account ? "Save changes" : "Create the account"}
      </button>
    </form>
  );
}
