"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { userPayload } from "@/lib/people";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * Invites someone.
 *
 * No password is set here: they are emailed a single-use code and choose their
 * own, which also proves the address belongs to them. Roles are picked up
 * front because an account with none can sign in and do nothing.
 */
export default function UserForm({ roles, branches }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", roleIds: [], branchId: branches.length === 1 ? branches[0].id : "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const chosen = useMemo(() => roles.filter((role) => form.roleIds.includes(role.id)), [roles, form.roleIds]);
  const needsBranch = chosen.some((role) => role.scope === "BRANCH");

  function toggleRole(id) {
    set({ roleIds: form.roleIds.includes(id) ? form.roleIds.filter((value) => value !== id) : [...form.roleIds, id] });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = userPayload({ ...form, needsBranch });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");
    setPending(true);
    setFormError(null);
    try {
      const user = await api.post("/admin/users", body);
      toast.success(`Invitation sent to ${user.email}.`);
      router.push(`/dashboard/users/${user.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "The invitation could not be sent.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Who they are">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="user-name" label="Full name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} autoComplete="off" />
          <Field id="user-email" label="Email" type="email" value={form.email} onChange={(event) => set({ email: event.target.value })} error={errors.email} hint="The invitation goes here." autoComplete="off" />
        </div>
        <Field id="user-phone" label="Phone" value={form.phone} onChange={(event) => set({ phone: event.target.value })} error={errors.phone} hint="Optional." autoComplete="off" />
      </Section>

      <Section title="What they may do" description="Pick the role that matches the job. You can only grant roles below your own seniority.">
        {errors.roleIds ? <p className="text-label-bold text-error">{errors.roleIds}</p> : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {roles.map((role) => (
            <li key={role.id}>
              <label className={`flex cursor-pointer items-start gap-3 rounded-field p-3 ${form.roleIds.includes(role.id) ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface hover:bg-surface-container"}`}>
                <input type="checkbox" checked={form.roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} className="mt-1 size-4 accent-primary" />
                <span className="min-w-0">
                  <span className="block text-label-bold">{role.name}</span>
                  <span className="block text-body-md opacity-90">{role.description ?? (role.scope === "GLOBAL" ? "Company-wide" : "One branch")}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {needsBranch ? (
          <SelectField
            id="user-branch"
            label="Branch"
            value={form.branchId}
            onChange={(event) => set({ branchId: event.target.value })}
            options={[{ value: "", label: "Choose a branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
            error={errors.branchId}
            hint="Branch roles apply at one outlet. A company-wide role ignores this."
          />
        ) : null}
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Sending…">Send the invitation</SubmitButton>
      </div>
    </form>
  );
}
