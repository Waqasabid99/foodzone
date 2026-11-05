"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { ROLE_LEVELS, ROLE_SCOPES, rolePayload } from "@/lib/people";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * A role's name, reach and seniority.
 *
 * `maxLevel` is the most senior level this person may set: nobody can create a
 * role above their own standing, or they could promote themselves through it.
 */
export default function RoleDetailsForm({ role, maxLevel = 50 }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: role.name ?? "",
    description: role.description ?? "",
    scope: role.scope ?? "BRANCH",
    level: String(role.level ?? 50),
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const levels = ROLE_LEVELS.filter((level) => level.value >= maxLevel);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = rolePayload(form, { mode: "edit" });
    setErrors(local);
    if (Object.keys(local).length) return setError("Some fields need attention.");
    setPending(true);
    setError(null);
    try {
      await api.patch(`/admin/roles/${role.id}`, body);
      toast.success("Role saved.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="role-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} />
        <SelectField
          id="role-level"
          label="Seniority"
          value={form.level}
          onChange={(event) => set({ level: event.target.value })}
          options={levels.map((level) => ({ value: String(level.value), label: level.label }))}
          error={errors.level}
          hint="Lower is more senior. Someone may only grant roles below their own."
        />
      </div>
      <SelectField
        id="role-scope"
        label="Reach"
        value={form.scope}
        onChange={(event) => set({ scope: event.target.value })}
        options={ROLE_SCOPES.map((scope) => ({ value: scope.value, label: scope.label }))}
        hint={ROLE_SCOPES.find((scope) => scope.value === form.scope)?.hint}
      />
      <TextAreaField id="role-description" label="What this role is for" rows={2} value={form.description} onChange={(event) => set({ description: event.target.value })} error={errors.description} />
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
