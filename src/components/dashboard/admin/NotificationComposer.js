"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Sends a message to a whole role, at one branch or everywhere.
 *
 * Aimed at roles rather than individuals on purpose: "the managers at
 * Downtown" keeps being right as people join and leave, while a list of names
 * goes stale the first time somebody moves.
 */
export default function NotificationComposer({ roles, branches }) {
  const router = useRouter();
  const [form, setForm] = useState({ roleKey: "", branchId: "", title: "", body: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const role = roles.find((row) => row.key === form.roleKey) ?? null;
  const audience = !role
    ? null
    : role.scope === "GLOBAL" || !form.branchId
      ? `everyone with the ${role.name} role`
      : `${role.name}s at ${branches.find((branch) => branch.id === form.branchId)?.name}`;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const problems = {};
    if (!form.roleKey) problems.roleKey = "Choose who this goes to.";
    const title = form.title.trim();
    if (!title) problems.title = "A message needs a subject.";
    else if (title.length > 120) problems.title = "Keep it under 120 characters.";
    const body = form.body.trim();
    if (body.length > 500) problems.body = "Keep it under 500 characters.";
    setErrors(problems);
    if (Object.keys(problems).length) return setError("Some fields need attention.");

    if (!window.confirm(`Send “${title}” to ${audience}?`)) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.post("/admin/notifications", {
        roleKey: form.roleKey,
        branchId: form.branchId || null,
        title,
        ...(body ? { body } : {}),
      });
      toast.success(result?.created ? `Sent to ${result.created} ${result.created === 1 ? "person" : "people"}.` : "Sent.");
      set({ title: "", body: "" });
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="notify-role"
          label="Send to"
          value={form.roleKey}
          onChange={(event) => set({ roleKey: event.target.value })}
          options={[{ value: "", label: "Choose a role" }, ...roles.map((row) => ({ value: row.key, label: row.name }))]}
          error={errors.roleKey}
        />
        <SelectField
          id="notify-branch"
          label="At"
          value={form.branchId}
          onChange={(event) => set({ branchId: event.target.value })}
          disabled={role?.scope === "GLOBAL"}
          options={[{ value: "", label: "Every branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
          hint={role?.scope === "GLOBAL" ? "This role is company-wide." : "Only the people holding that role there."}
        />
      </div>
      <Field id="notify-title" label="Subject" value={form.title} onChange={(event) => set({ title: event.target.value })} error={errors.title} placeholder="e.g. Deep clean on Sunday" />
      <TextAreaField id="notify-body" label="Message" rows={3} value={form.body} onChange={(event) => set({ body: event.target.value })} error={errors.body} hint="Optional. Keep it short — it appears as a notification." />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Sending…" : "Send"}
        </button>
        {audience ? <p className="text-body-md text-on-surface-variant">Goes to {audience}.</p> : null}
      </div>
    </form>
  );
}
