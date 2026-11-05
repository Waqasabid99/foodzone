"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { EMPLOYMENT_TYPES, employeePayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Taking somebody on, and editing them afterwards.
 *
 * Pay is deliberately absent: it lives behind `employees.manage_salary` on its
 * own form, so the screen that lets a supervisor fix a phone number can be open
 * to supervisors without also letting them award a raise.
 *
 * The branch cannot be changed after the fact. An employee's branch is stamped
 * on every attendance day and roster row they have; moving it would leave that
 * history pointing at an outlet they never worked at.
 */
export default function EmployeeForm({
  employee = null,
  branches,
  departments,
  accounts,
  canLinkAccount = true,
}) {
  const router = useRouter();
  const editing = Boolean(employee);

  const [form, setForm] = useState({
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    branchId: employee?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    departmentId: employee?.departmentId ?? "",
    designation: employee?.designation ?? "",
    employmentType: employee?.employmentType ?? "FULL_TIME",
    employeeCode: "",
    personalEmail: employee?.personalEmail ?? "",
    phone: employee?.phone ?? "",
    dateOfBirth: employee?.dateOfBirth ? String(employee.dateOfBirth).slice(0, 10) : "",
    address: employee?.address ?? "",
    emergencyContactName: employee?.emergencyContactName ?? "",
    emergencyContactPhone: employee?.emergencyContactPhone ?? "",
    biometricId: employee?.biometricId ?? "",
    userId: employee?.userId ?? "",
    joinedAt: employee?.joinedAt ? String(employee.joinedAt).slice(0, 10) : today(),
  });

  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = employeePayload(form, { mode: editing ? "edit" : "create" });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/admin/employees/${employee.id}`, body);
        toast.success("Saved.");
        router.push(`/dashboard/employees/${employee.id}`);
      } else {
        const created = await api.post("/admin/employees", body);
        toast.success(`${created.employeeCode} added.`);
        router.push(`/dashboard/employees/${created.id}`);
      }
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="emp-first" label="First name" value={form.firstName} onChange={(event) => set({ firstName: event.target.value })} error={errors.firstName} autoComplete="off" />
          <Field id="emp-last" label="Last name" value={form.lastName} onChange={(event) => set({ lastName: event.target.value })} error={errors.lastName} hint="Optional." autoComplete="off" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="emp-email" label="Personal email" type="email" value={form.personalEmail} onChange={(event) => set({ personalEmail: event.target.value })} error={errors.personalEmail} hint="Theirs, not a work address." autoComplete="off" />
          <Field id="emp-phone" label="Phone" value={form.phone} onChange={(event) => set({ phone: event.target.value })} error={errors.phone} autoComplete="off" />
        </div>
        <Field id="emp-dob" label="Date of birth" type="date" value={form.dateOfBirth} onChange={(event) => set({ dateOfBirth: event.target.value })} error={errors.dateOfBirth} hint="Optional." />
        <TextAreaField id="emp-address" label="Address" rows={3} value={form.address} onChange={(event) => set({ address: event.target.value })} error={errors.address} />
      </Section>

      <Section title="The job">
        <div className="grid gap-4 sm:grid-cols-2">
          {editing ? (
            <div>
              <p className="text-label-bold text-on-surface">Branch</p>
              <p className="mt-1 text-body-md text-on-surface-variant">
                {branches.find((branch) => branch.id === employee.branchId)?.name ?? "Another branch"} — fixed, because
                every shift and attendance day they have is stamped with it.
              </p>
            </div>
          ) : (
            <SelectField
              id="emp-branch"
              label="Branch"
              value={form.branchId}
              onChange={(event) => set({ branchId: event.target.value })}
              options={[{ value: "", label: "Choose a branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
              error={errors.branchId}
              hint="Where they work. This cannot be changed later."
            />
          )}

          <SelectField
            id="emp-department"
            label="Department"
            value={form.departmentId}
            onChange={(event) => set({ departmentId: event.target.value })}
            options={[{ value: "", label: "No department" }, ...departments.map((department) => ({ value: department.id, label: department.name }))]}
            error={errors.departmentId}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="emp-designation" label="Job title" value={form.designation} onChange={(event) => set({ designation: event.target.value })} error={errors.designation} hint="Line cook, cashier, shift supervisor." autoComplete="off" />
          <SelectField
            id="emp-type"
            label="Employment type"
            value={form.employmentType}
            onChange={(event) => set({ employmentType: event.target.value })}
            options={Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }))}
            error={errors.employmentType}
          />
        </div>

        {editing ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="emp-joined" label="Started on" type="date" value={form.joinedAt} onChange={(event) => set({ joinedAt: event.target.value })} error={errors.joinedAt} />
            <Field id="emp-code" label="Staff number" value={form.employeeCode} onChange={(event) => set({ employeeCode: event.target.value })} error={errors.employeeCode} hint="Left empty, one is generated from the branch code." autoComplete="off" />
          </div>
        )}
      </Section>

      <Section
        title="Clocking in"
        description="The id enrolled on the attendance terminal. Punches arrive with this, not with anything from here — until it matches, their attendance is recorded but not counted."
      >
        <Field id="emp-biometric" label="Biometric id" value={form.biometricId} onChange={(event) => set({ biometricId: event.target.value })} error={errors.biometricId} hint="One person per id. Leave it empty until they are enrolled." autoComplete="off" />
      </Section>

      {canLinkAccount ? (
        <Section
          title="Sign-in account"
          description="Only if they use the system. Plenty of staff never sign in — a porter exists to be rostered and paid. Accounts are created under Users, then linked here."
        >
          <SelectField
            id="emp-user"
            label="Linked account"
            value={form.userId}
            onChange={(event) => set({ userId: event.target.value })}
            options={[
              { value: "", label: "No sign-in account" },
              ...accounts.map((account) => ({ value: account.id, label: `${account.name} — ${account.email ?? "no email"}` })),
            ]}
            error={errors.userId}
            hint="Accounts already linked to another employee are not listed."
          />
        </Section>
      ) : null}

      <Section title="In an emergency">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="emp-ice-name" label="Who to call" value={form.emergencyContactName} onChange={(event) => set({ emergencyContactName: event.target.value })} error={errors.emergencyContactName} autoComplete="off" />
          <Field id="emp-ice-phone" label="Their phone" value={form.emergencyContactPhone} onChange={(event) => set({ emergencyContactPhone: event.target.value })} error={errors.emergencyContactPhone} autoComplete="off" />
        </div>
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save changes" : "Add this person"}</SubmitButton>
      </div>
    </form>
  );
}
