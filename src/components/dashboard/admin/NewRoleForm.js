"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { ROLE_LEVELS, ROLE_SCOPES, rolePayload } from "@/lib/people";
import PermissionMatrix from "@/components/dashboard/admin/PermissionMatrix";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A role of your own, optionally starting from a built-in one.
 *
 * Copying is the supported way to vary a built-in role: those are fixed so an
 * upgrade cannot quietly change what a job can do, and a copy gives you
 * something you own.
 */
export default function NewRoleForm({ modules, holds, isSuperAdmin, maxLevel = 50, copyFrom = null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: copyFrom ? `${copyFrom.name} (copy)` : "",
    description: copyFrom?.description ?? "",
    scope: copyFrom?.scope ?? "BRANCH",
    level: String(copyFrom ? Math.max(copyFrom.level, maxLevel) : Math.max(50, maxLevel)),
  });
  // Only what this person could grant themselves is carried over from a copy.
  const [selected, setSelected] = useState(() =>
    (copyFrom?.permissions ?? []).map((permission) => permission.key).filter((key) => isSuperAdmin || holds.includes(key)),
  );
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const levels = ROLE_LEVELS.filter((level) => level.value >= maxLevel);
  const dropped = (copyFrom?.permissions ?? []).length - selected.length;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = rolePayload({ ...form, permissionKeys: selected }, { mode: "create" });
    setErrors(local);
    if (Object.keys(local).length) return setError(local.permissionKeys ?? "Some fields need attention.");
    setPending(true);
    setError(null);
    try {
      const role = await api.post("/admin/roles", body);
      toast.success(`${role.name} created.`);
      router.push(`/dashboard/roles/${role.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "The role could not be created.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{error}</FormAlert>

      <Section title="The role">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="role-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} placeholder="e.g. Weekend supervisor" />
          <SelectField
            id="role-level"
            label="Seniority"
            value={form.level}
            onChange={(event) => set({ level: event.target.value })}
            options={levels.map((level) => ({ value: String(level.value), label: level.label }))}
            error={errors.level}
            hint="Lower is more senior. You cannot create a role at or above your own."
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
        <TextAreaField id="role-description" label="What this role is for" rows={2} value={form.description} onChange={(event) => set({ description: event.target.value })} error={errors.description} hint="The next administrator reads this to decide who should have it." />
      </Section>

      <Section title="Permissions" description="Tick what this role may do.">
        {copyFrom && dropped > 0 ? (
          <p role="status" className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            {dropped} of {copyFrom.name}&apos;s permissions were left out because you do not hold them yourself.
          </p>
        ) : null}
        {errors.permissionKeys ? <p className="text-label-bold text-error">{errors.permissionKeys}</p> : null}
        <PermissionMatrix modules={modules} selected={selected} onChange={setSelected} holds={holds} isSuperAdmin={isSuperAdmin} />
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Creating…">Create the role</SubmitButton>
      </div>
    </form>
  );
}
